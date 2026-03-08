import { useState, useEffect, useCallback } from "react";
import {
  getPageAnalytics,
  type Page,
  type PageAnalytics,
  type Agent,
} from "../lib/api";
import {
  getOrCreateX25519Keypair,
  loadAgentX25519Key,
} from "../lib/crypto";
import { deriveE2EKey, encryptedRelay, x25519KeyId } from "../lib/e2e";

export interface AgentPages {
  agent: Agent;
  pages: Page[];
}

export function usePages(
  agents: Agent[],
  getStatus: (id: string) => string | undefined
) {
  const [agentPages, setAgentPages] = useState<AgentPages[]>([]);
  const [analytics, setAnalytics] = useState<Map<string, PageAnalytics>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // All online paired agents
  const pairedOnline = agents.filter(
    (a) => a.is_online && getStatus(a.id) === "paired"
  );

  // Stable key to detect when the set of paired agents changes
  const agentKey = pairedOnline.map((a) => a.id).sort().join(",");

  useEffect(() => {
    if (pairedOnline.length === 0) {
      setAgentPages([]);
      setLoading(false);
      return;
    }
    if (loadedKey === agentKey) return;

    setLoading(true);
    Promise.all([
      Promise.all(
        pairedOnline.map(async (agent) => {
          try {
            const agentPubBytes = await loadAgentX25519Key(agent.id);
            if (!agentPubBytes) return { agent, pages: [] as Page[] };
            const x25519kp = await getOrCreateX25519Keypair();
            const aesKey = await deriveE2EKey(x25519kp.privateKey, agentPubBytes);
            const userKeyID = x25519KeyId(x25519kp.publicKeyBytes);
            const resp = await encryptedRelay(agent.id, aesKey, userKeyID, {
              method: "GET",
              path: "/api/pages",
            });
            if (resp && resp.status === 200 && resp.body) {
              return { agent, pages: JSON.parse(resp.body) as Page[] };
            }
            return { agent, pages: [] as Page[] };
          } catch {
            return { agent, pages: [] as Page[] };
          }
        })
      ),
      getPageAnalytics().catch(() => [] as PageAnalytics[]),
    ]).then(([results, a]) => {
      setAgentPages(results);
      const map = new Map<string, PageAnalytics>();
      for (const item of a) map.set(item.slug, item);
      setAnalytics(map);
      setLoadedKey(agentKey);
      setLoading(false);
    });
  }, [agentKey, loadedKey]);

  const reload = useCallback(() => {
    setLoadedKey(null);
  }, []);

  const deletePage = useCallback(
    async (slug: string, agentId: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const agentPubBytes = await loadAgentX25519Key(agentId);
        if (!agentPubBytes) {
          return { ok: false, error: "Agent encryption keys missing. Re-pair your agent." };
        }
        const x25519kp = await getOrCreateX25519Keypair();
        const aesKey = await deriveE2EKey(x25519kp.privateKey, agentPubBytes);
        const userKeyID = x25519KeyId(x25519kp.publicKeyBytes);
        const resp = await encryptedRelay(agentId, aesKey, userKeyID, {
          method: "DELETE",
          path: `/api/page/${encodeURIComponent(slug)}`,
        });
        if (!resp || resp.status < 200 || resp.status >= 300) {
          return { ok: false, error: resp?.body || "unknown error" };
        }
        reload();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [reload]
  );

  const hasAgent = pairedOnline.length > 0;
  const anyOnline = agents.some((a) => a.is_online);

  return { agentPages, analytics, loading, deletePage, hasAgent, anyOnline };
}

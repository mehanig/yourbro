import { useState, useEffect, useCallback } from "react";
import {
  listPagesViaRelay,
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

export function usePages(
  agents: Agent[],
  getStatus: (id: number) => string | undefined
) {
  const [pages, setPages] = useState<Page[]>([]);
  const [analytics, setAnalytics] = useState<Map<string, PageAnalytics>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [loadedAgentId, setLoadedAgentId] = useState<number | null>(null);

  // Find first online paired agent
  const onlineAgent = agents.find(
    (a) => a.is_online && getStatus(a.id) === "paired"
  );

  useEffect(() => {
    if (!onlineAgent) {
      setLoading(false);
      return;
    }
    if (loadedAgentId === onlineAgent.id) return;

    setLoading(true);
    Promise.all([
      listPagesViaRelay(onlineAgent.id),
      getPageAnalytics().catch(() => [] as PageAnalytics[]),
    ]).then(([p, a]) => {
      setPages(p);
      const map = new Map<string, PageAnalytics>();
      for (const item of a) map.set(item.slug, item);
      setAnalytics(map);
      setLoadedAgentId(onlineAgent.id);
      setLoading(false);
    });
  }, [onlineAgent, loadedAgentId]);

  const reload = useCallback(() => {
    if (!onlineAgent) return;
    setLoadedAgentId(null); // triggers refetch
  }, [onlineAgent]);

  const deletePage = useCallback(
    async (slug: string, agentId: number): Promise<{ ok: boolean; error?: string }> => {
      try {
        const agentPubBytes = await loadAgentX25519Key(String(agentId));
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

  return { pages, analytics, loading, deletePage, onlineAgentId: onlineAgent?.id ?? null };
}

import { useState, useCallback, useRef, useEffect } from "react";
import { API_BASE, deleteAgent, type Agent } from "../lib/api";
import {
  getOrCreateX25519Keypair,
  storeAgentX25519Key,
  loadAgentX25519Key,
  base64RawUrlEncode,
  base64RawUrlDecode,
} from "../lib/crypto";
import { deriveE2EKey, encryptedRelay, x25519KeyId } from "../lib/e2e";

type PairingStatus = "checking" | "paired" | "unpaired";

async function probeAgentPairing(agentId: number): Promise<boolean> {
  try {
    const agentPubBytes = await loadAgentX25519Key(String(agentId));
    if (!agentPubBytes) return false;
    const x25519kp = await getOrCreateX25519Keypair();
    const aesKey = await deriveE2EKey(x25519kp.privateKey, agentPubBytes);
    const userKeyID = x25519KeyId(x25519kp.publicKeyBytes);
    const resp = await encryptedRelay(agentId, aesKey, userKeyID, {
      method: "POST",
      path: "/api/auth-check",
    });
    return resp !== null && resp.status === 200;
  } catch {
    return false;
  }
}

export function usePairingStatus(agents: Agent[]) {
  const [statusMap, setStatusMap] = useState<Map<number, PairingStatus>>(
    new Map()
  );
  const [hasKeypair, setHasKeypair] = useState(false);
  const probedRef = useRef<Set<number>>(new Set());

  // Check for keypair on mount
  useEffect(() => {
    getOrCreateX25519Keypair()
      .then(() => setHasKeypair(true))
      .catch(() => setHasKeypair(false));
  }, []);

  // Probe online agents when they appear
  useEffect(() => {
    if (!hasKeypair) {
      // No keypair — all online agents are unpaired
      const newMap = new Map(statusMap);
      let changed = false;
      for (const a of agents) {
        if (a.is_online && !newMap.has(a.id)) {
          newMap.set(a.id, "unpaired");
          changed = true;
        }
      }
      if (changed) setStatusMap(newMap);
      return;
    }

    for (const a of agents) {
      if (a.is_online && !probedRef.current.has(a.id)) {
        probedRef.current.add(a.id);
        setStatusMap((prev) => new Map(prev).set(a.id, "checking"));
        probeAgentPairing(a.id).then((isPaired) => {
          setStatusMap((prev) =>
            new Map(prev).set(a.id, isPaired ? "paired" : "unpaired")
          );
        });
      }
    }
  }, [agents, hasKeypair, statusMap]);

  const getStatus = useCallback(
    (id: number): PairingStatus | undefined => statusMap.get(id),
    [statusMap]
  );

  const pairAgent = useCallback(
    async (
      agentId: number,
      code: string,
      username: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const x25519kp = await getOrCreateX25519Keypair();
        const x25519PubB64 = base64RawUrlEncode(x25519kp.publicKeyBytes);

        const res = await fetch(`${API_BASE}/api/relay/${agentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            id: crypto.randomUUID(),
            method: "POST",
            path: "/api/pair",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pairing_code: code,
              user_x25519_public_key: x25519PubB64,
              username,
            }),
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: res.statusText }));
          return { ok: false, error: data.error || res.statusText };
        }

        const relayResp = await res.json();
        const pairResp = relayResp.body
          ? JSON.parse(relayResp.body)
          : relayResp;
        if (pairResp.agent_x25519_public_key) {
          const agentX25519Bytes = base64RawUrlDecode(
            pairResp.agent_x25519_public_key
          );
          await storeAgentX25519Key(String(agentId), agentX25519Bytes);
        }

        setStatusMap((prev) => new Map(prev).set(agentId, "paired"));
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    []
  );

  const removeAgent = useCallback(
    async (agentId: number): Promise<void> => {
      try {
        const agentPubBytes = await loadAgentX25519Key(String(agentId));
        if (agentPubBytes) {
          const x25519kp = await getOrCreateX25519Keypair();
          const aesKey = await deriveE2EKey(
            x25519kp.privateKey,
            agentPubBytes
          );
          const userKeyID = x25519KeyId(x25519kp.publicKeyBytes);
          await encryptedRelay(agentId, aesKey, userKeyID, {
            method: "POST",
            path: "/api/revoke-key",
          });
        }
      } catch (err) {
        console.warn("Relay revocation failed:", err);
      }
      await deleteAgent(agentId);
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.delete(agentId);
        return next;
      });
      probedRef.current.delete(agentId);
    },
    []
  );

  return { getStatus, pairAgent, removeAgent, hasKeypair };
}

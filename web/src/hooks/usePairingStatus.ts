import { useState, useCallback, useRef, useEffect } from "react";
import { deleteAgent, type Agent } from "../lib/api";
import {
  getOrCreateX25519Keypair,
  storeAgentX25519Key,
  loadAgentX25519Key,
  base64RawUrlDecode,
} from "../lib/crypto";
import { deriveE2EKey, encryptedRelay, x25519KeyId } from "../lib/e2e";

type PairingStatus = "checking" | "paired" | "unpaired";

async function probeAgentPairing(agentId: string): Promise<boolean> {
  try {
    const agentPubBytes = await loadAgentX25519Key(agentId);
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
  const [statusMap, setStatusMap] = useState<Map<string, PairingStatus>>(
    new Map()
  );
  const [hasKeypair, setHasKeypair] = useState(false);
  const probedRef = useRef<Set<string>>(new Set());

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
    (id: string): PairingStatus | undefined => statusMap.get(id),
    [statusMap]
  );

  const pairAgent = useCallback(
    async (
      agentId: string,
      code: string,
      username: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        // Find agent's X25519 public key from the agent list
        const agent = agents.find((a) => a.id === agentId);
        if (!agent?.x25519_public) {
          return { ok: false, error: "Agent encryption key not available. Try again." };
        }
        const agentPubBytes = base64RawUrlDecode(agent.x25519_public);
        await storeAgentX25519Key(agentId, agentPubBytes);

        const x25519kp = await getOrCreateX25519Keypair();
        const aesKey = await deriveE2EKey(x25519kp.privateKey, agentPubBytes);
        const userKeyID = x25519KeyId(x25519kp.publicKeyBytes);

        const resp = await encryptedRelay(agentId, aesKey, userKeyID, {
          method: "POST",
          path: "/api/pair",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairing_code: code,
            user_x25519_public_key: userKeyID,
            username,
          }),
        });

        if (!resp || resp.status < 200 || resp.status >= 300) {
          const error = resp?.body ? JSON.parse(resp.body).error : "Pairing failed";
          return { ok: false, error };
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
    [agents]
  );

  const removeAgent = useCallback(
    async (agentId: string): Promise<void> => {
      try {
        const agentPubBytes = await loadAgentX25519Key(agentId);
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

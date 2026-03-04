---
title: "Incomplete Agent Key Revocation on Removal"
category: security-issues
tags:
  - authentication
  - key-revocation
  - pairing
  - rfc-9421
  - ed25519
  - zero-trust
module:
  - agent/internal/handlers/pair.go
  - agent/internal/middleware/auth.go
  - agent/internal/storage/sqlite.go
  - agent/cmd/server/main.go
  - web/src/lib/crypto.ts
  - web/src/pages/dashboard.ts
symptom: "User removes paired agent from dashboard, but browser can still make authenticated requests to agent"
root_cause: "Dashboard only deleted server-side Postgres record; agent's SQLite authorized_keys and browser's IndexedDB private key were never revoked"
date: 2026-03-04
severity: high
impact: "Unpaired agents remain accessible to browsers indefinitely after user believes pairing is revoked"
---

# Incomplete Agent Key Revocation on Removal

## Problem

When a user clicked "Remove" on a paired agent in the dashboard, only the server-side Postgres record was deleted (`DELETE /api/agents/{id}`). The agent's SQLite `authorized_keys` table still contained the user's public key, and the browser still had the private key in IndexedDB.

**Result:** After "Remove", the browser could still make authenticated RFC 9421 signed requests to the agent. The pairing was not actually revoked.

```
Broken flow:
User clicks Remove -> DELETE /api/agents/{id} -> Postgres row deleted -> Done
                      (agent still has public key, browser still has private key)
```

## Root Cause

The Remove flow only targeted the server-side database record. No mechanism existed to communicate key revocation to the agent. The agent had no key revocation endpoint. This created an asymmetric state where the server thought a pairing was removed, but the agent still trusted the client's key.

## Solution

Browser-initiated key revocation via RFC 9421 signed `DELETE /api/keys` request to the agent. Six files changed:

### 1. Agent storage (`agent/internal/storage/sqlite.go`)

Added `DeleteAuthorizedKey()` — deletes from SQLite and reloads in-memory cache:

```go
func (d *DB) DeleteAuthorizedKey(publicKey string) error {
    _, err := d.db.Exec(`DELETE FROM authorized_keys WHERE public_key = ?`, publicKey)
    if err != nil {
        return err
    }
    return d.reloadAuthKeys()
}
```

### 2. Agent middleware (`agent/internal/middleware/auth.go`)

Added public key to request context so handlers can identify the caller:

```go
const publicKeyKey contextKey = "public_key"

func GetPublicKey(r *http.Request) string {
    if v, ok := r.Context().Value(publicKeyKey).(string); ok {
        return v
    }
    return ""
}

// In VerifyUserSignature, after successful verification:
ctx := context.WithValue(r.Context(), usernameKey, username)
ctx = context.WithValue(ctx, publicKeyKey, keyID)
```

### 3. Agent handler (`agent/internal/handlers/pair.go`)

Added `RevokeKey` — reads public key from context (set by middleware), deletes it:

```go
func (h *PairHandler) RevokeKey(w http.ResponseWriter, r *http.Request) {
    publicKey := middleware.GetPublicKey(r)
    if publicKey == "" {
        writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no public key in context"})
        return
    }
    if err := h.DB.DeleteAuthorizedKey(publicKey); err != nil {
        writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to revoke key"})
        return
    }
    writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
```

### 4. Agent routing (`agent/cmd/server/main.go`)

Wired route under signature verification middleware:

```go
r.Route("/api/keys", func(r chi.Router) {
    r.Use(mw.VerifyUserSignature(db))
    r.Delete("/", pairHandler.RevokeKey)
})
```

### 5. Web crypto (`web/src/lib/crypto.ts`)

Added standalone `signedFetch()` for the dashboard to make RFC 9421 signed requests:

```typescript
export async function signedFetch(
  method: string,
  url: string,
  body?: string
): Promise<Response> {
  const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
  const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);
  const created = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();

  const coveredComponents = body
    ? '("@method" "@target-uri" "content-digest")'
    : '("@method" "@target-uri")';
  const sigParams = `${coveredComponents};created=${created};nonce="${nonce}";keyid="${pubKeyB64}"`;

  const lines = [`"@method": ${method}`, `"@target-uri": ${url}`];
  // ... content-digest if body present ...
  lines.push(`"@signature-params": ${sigParams}`);
  const signatureBase = lines.join("\n");

  const sig = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(signatureBase));
  return fetch(url, {
    method,
    headers: { "Signature-Input": `sig1=${sigParams}`, Signature: `sig1=:${base64StdEncode(new Uint8Array(sig))}:` },
    body,
  });
}
```

### 6. Dashboard (`web/src/pages/dashboard.ts`)

Remove button now sends signed revocation, waits for agent confirmation, blocks if offline:

```typescript
btn.addEventListener("click", async () => {
  const id = Number((btn as HTMLElement).dataset.id);
  const endpoint = (btn as HTMLElement).dataset.endpoint;
  if (!confirm("Remove this agent?")) return;

  // Step 1: Revoke key on agent — must succeed before removing server record
  if (endpoint) {
    try {
      const res = await signedFetch("DELETE", `${endpoint}/api/keys`);
      if (!res.ok) {
        alert(`Can't unpair: ${(await res.json()).error || res.statusText}`);
        return;  // Keep server record for retry
      }
    } catch {
      alert("Can't unpair: agent is offline or unreachable.\nTry again when the agent is back online.");
      return;  // Keep server record for retry
    }
  }

  // Step 2: Agent confirmed — safe to remove server record
  await deleteAgent(id);
  renderDashboard(container);
});
```

## Key Design Decisions

- **Browser-initiated revocation** — follows zero-trust model where server is untrusted broker. Browser has the private key and can prove ownership.
- **Agent confirmation required** — server record only deleted after agent confirms key deletion. Prevents orphaned states.
- **Offline blocks removal** — if agent is unreachable, removal fails and server record is retained for retry. Ensures eventual consistency.
- **Same signing mechanism** — uses existing RFC 9421 HTTP Message Signatures, no new auth mechanism needed.

## Prevention Strategies

- When designing multi-system state changes, always ensure all systems agree before considering the operation complete.
- Implement a checklist: for any "delete" operation, enumerate every system that holds related state and ensure each is cleaned up.
- For distributed credential management, treat revocation as a first-class operation — design the revocation endpoint alongside the creation endpoint.

## Testing Recommendations

- Test full removal flow: pair agent, verify access, remove, verify access is denied.
- Test offline scenario: pair agent, stop agent, attempt remove, verify error shown and server record preserved.
- Test that revoked keys are immediately rejected on subsequent storage requests.
- Test concurrent removal attempts (two tabs removing same agent).

## Related

- `docs/solutions/integration-issues/sse-real-time-dashboard-agent-status.md` — SSE agent status (how online/offline is tracked)
- `docs/solutions/integration-issues/sandboxed-iframe-sdk-delivery-with-keypair-relay.md` — Ed25519 keypair management and RFC 9421 signing
- `docs/plans/2026-03-04-fix-agent-removal-revoke-authorized-key-plan.md` — Original plan for this fix

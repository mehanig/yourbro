---
title: "fix: Revoke agent authorized key when user removes paired agent"
type: fix
status: active
date: 2026-03-04
---

# fix: Revoke agent authorized key when user removes paired agent

## Problem Statement

When user clicks "Remove" on a paired agent in the dashboard, only the server-side `agents` table row is deleted (`api/internal/storage/postgres.go:287`). The agent machine still has the user's public key in its `authorized_keys` SQLite table (`agent/internal/storage/sqlite.go:36`), and the browser still has the private key in IndexedDB.

**Result:** After "Remove", the browser can still make authenticated storage requests to the agent. The pairing is not actually revoked.

### Current flow (broken):
```
User clicks Remove → DELETE /api/agents/{id} → Postgres row deleted → Done
                     (agent still has public key, browser still has private key)
```

### Desired flow:
```
User clicks Remove → Browser signs DELETE /api/keys to agent → Agent confirms key deleted
                   → DELETE /api/agents/{id} → Postgres row deleted → Done

If agent is offline → Show error "Agent is offline, can't unpair right now"
                    → Server record stays → User can retry when agent is back online
```

## Proposed Solution

**Browser-initiated key revocation** — the browser already has the private key, so it can prove identity to the agent and request its own key be removed. This follows the existing zero-trust model.

### 1. Add key revocation endpoint on agent — `agent/internal/handlers/pair.go`

New endpoint: `DELETE /api/keys`

Protected by the same RFC 9421 signature verification middleware. The agent verifies the request signature, confirms the signing key matches an authorized key, then deletes that key from `authorized_keys`.

```go
// Route (no slug needed — uses the signing key itself as identifier)
r.Route("/api/keys", func(r chi.Router) {
    r.Use(mw.VerifyUserSignature(db))
    r.Delete("/", pairHandler.RevokeKey)
})
```

Handler:
```go
func (h *PairHandler) RevokeKey(w http.ResponseWriter, r *http.Request) {
    // The middleware already verified the signature and extracted the public key
    publicKey := middleware.GetPublicKey(r)  // from context, set by VerifyUserSignature

    if err := h.DB.DeleteAuthorizedKey(publicKey); err != nil {
        writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to revoke key"})
        return
    }

    writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
```

### 2. Add `DeleteAuthorizedKey` to agent storage — `agent/internal/storage/sqlite.go`

```go
func (d *DB) DeleteAuthorizedKey(publicKey string) error {
    _, err := d.db.Exec("DELETE FROM authorized_keys WHERE public_key = ?", publicKey)
    if err != nil {
        return err
    }
    d.reloadAuthKeys()
    return nil
}
```

### 3. Extract public key in middleware context — `agent/internal/middleware/auth.go`

The `VerifyUserSignature` middleware already extracts and verifies the public key. Add it to the request context so handlers can access it:

```go
// After successful verification (around line 205-210)
ctx = context.WithValue(ctx, PublicKeyCtxKey, keyID)  // keyID is the base64url public key
```

Add helper:
```go
func GetPublicKey(r *http.Request) string {
    pk, _ := r.Context().Value(PublicKeyCtxKey).(string)
    return pk
}
```

### 4. Update dashboard Remove handler — `web/src/pages/dashboard.ts`

Before deleting the server-side record, send a signed revocation request to the agent:

```typescript
// In renderAgentsList delete handler
btn.addEventListener("click", async () => {
    const id = Number((btn as HTMLElement).dataset.id);
    const endpoint = (btn as HTMLElement).dataset.endpoint;
    if (!confirm("Remove this agent?")) return;

    // Step 1: Revoke key on agent — MUST succeed before we remove server record
    if (endpoint) {
        try {
            await revokeAgentKey(endpoint);
        } catch (err) {
            alert(`Can't unpair: agent is offline or unreachable.\nTry again when the agent is back online.`);
            return;  // Don't remove server record — user can retry later
        }
    }
    // Step 2: Agent confirmed revocation — now safe to remove from server
    await deleteAgent(id);
    renderDashboard(container);
});
```

### 5. Add `revokeAgentKey` function — `web/src/lib/api.ts` or `web/src/lib/crypto.ts`

This needs to make a signed HTTP request (RFC 9421) to the agent's `DELETE /api/keys`. The SDK already has signing logic — extract and reuse it, or implement a lightweight version for the dashboard.

```typescript
async function revokeAgentKey(endpoint: string): Promise<void> {
    const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
    // Sign the request using RFC 9421 (same as SDK does)
    const url = `${endpoint}/api/keys`;
    const method = "DELETE";
    // ... build Signature-Input and Signature headers ...
    await fetch(url, { method, headers: { "Signature-Input": ..., "Signature": ... } });
}
```

**Note:** The signing logic currently lives in `sdk/src/index.ts` (lines 96-145). We need to either:
- Extract it into a shared utility
- Or duplicate the minimal signing code in `web/src/lib/crypto.ts`

Since the dashboard is on the main origin (not sandboxed), it has direct access to IndexedDB and the keypair.

### 6. Add `data-endpoint` to agent list HTML — `web/src/pages/dashboard.ts`

The Remove button needs to know the agent's endpoint URL:

```html
<button class="delete-agent" data-id="${a.id}" data-endpoint="${a.endpoint}" ...>Remove</button>
```

## Edge Cases

| Case | Handling |
|------|----------|
| Agent is offline when user clicks Remove | Show error: "Agent is offline, can't unpair right now." Server record stays — user retries when agent is back online. |
| User has no keypair (cleared IndexedDB) | Show error: "No keypair found." Can't sign revocation request. User would need to re-pair first, or we could add a force-remove option later. |
| Agent endpoint changed/unreachable | Same as offline — error, don't remove server record. |
| Multiple browsers paired with same agent | Each browser has its own keypair. Removing from one browser only revokes that browser's key. |

## Acceptance Criteria

- [ ] Agent has `DELETE /api/keys` endpoint protected by signature verification
- [ ] Agent deletes the signing key from `authorized_keys` on successful revocation
- [ ] Dashboard sends signed revocation to agent, waits for confirmation
- [ ] Server record only deleted AFTER agent confirms key revocation
- [ ] If agent is offline/unreachable, show error and keep server record intact
- [ ] After successful revocation, browser can no longer make storage requests to agent
- [ ] Agent reloads in-memory key cache after deletion

## Files to Modify

| File | Change |
|------|--------|
| `agent/internal/storage/sqlite.go` | Add `DeleteAuthorizedKey()` method |
| `agent/internal/middleware/auth.go` | Add public key to request context |
| `agent/internal/handlers/pair.go` | Add `RevokeKey` handler |
| `agent/cmd/server/main.go` | Wire `DELETE /api/keys` route |
| `web/src/lib/crypto.ts` | Add RFC 9421 signing function for revocation |
| `web/src/pages/dashboard.ts` | Call revocation before server-side delete, add `data-endpoint` attr |

## Context

- Agent auth: RFC 9421 HTTP Message Signatures with Ed25519 — `agent/internal/middleware/auth.go`
- Authorized keys: SQLite `authorized_keys` table with in-memory cache — `agent/internal/storage/sqlite.go`
- Pairing: One-time code + public key exchange — `agent/internal/handlers/pair.go`
- Dashboard: `web/src/pages/dashboard.ts` — agent list with Remove buttons
- Keypair storage: IndexedDB on main origin — `web/src/lib/crypto.ts`
- SDK signing logic: `sdk/src/index.ts:96-145` — RFC 9421 implementation to reuse

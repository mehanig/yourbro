---
title: E2E Encrypted Relay Agent — Sandboxed Iframe Integration
category: integration-issues
tags: [e2e-encryption, websocket-relay, cors, csp, sandboxed-iframe, sqlite-migration, aes-gcm, x25519]
module: [api, sdk, agent, nginx]
symptom: |
  Multiple failures when testing relay-mode agent pages in browser:
  CORS errors, CSP violations, 401/400/503 HTTP errors, empty JSON responses,
  and blocked modal dialogs — all stemming from sandboxed iframe constraints.
root_cause: |
  Architectural mismatch between E2E encryption requirements and sandbox/iframe
  constraints. Sandboxed iframes (allow-scripts only) have origin "null", can't
  access cookies, block modals, and require all auth via explicit headers.
---

# E2E Encrypted Relay Agent — Sandboxed Iframe Integration

## Problem

After implementing E2E encryption (X25519 ECDH + AES-256-GCM) for the WebSocket relay, the page content iframe failed to communicate with the relay API. Seven distinct issues surfaced during browser testing, each caused by the interaction between sandboxed iframes and the relay/encryption architecture.

## Issues and Fixes

### 1. CORS: origin "null" blocked

**Symptom:** `Access to fetch blocked by CORS policy: No 'Access-Control-Allow-Origin' header`

Sandboxed iframes without `allow-same-origin` have origin `"null"`. The API CORS config only allowed `frontendURL`.

**Fix** (`api/cmd/server/main.go`):
```go
AllowedOrigins: []string{frontendURL, "null"},
```

### 2. CSP: nonce blocks inline event handlers

**Symptom:** `Executing inline event handler violates CSP directive 'script-src 'nonce-...'`

Per CSP spec, `'unsafe-inline'` is ignored when a nonce is present. User page content with `onclick` handlers can't use nonces.

**Fix** (`api/internal/handlers/pages.go`): Removed nonce machinery entirely. Use `script-src 'unsafe-inline'` — the iframe sandbox attribute is the real security boundary. Removed `addNonceToScripts()` function and nonce generation.

### 3. Auth: 401 from sandboxed iframe

**Symptom:** `POST /api/relay/2 401 (Unauthorized)`

Sandboxed iframe can't access cookies. The SDK's `fetch()` had no auth credentials.

**Fix** (`sdk/src/index.ts`): Extract JWT from iframe URL `?token=` param, send as `Authorization: Bearer` header:
```typescript
const params = new URLSearchParams(window.location.search);
this.sessionToken = params.get("token");
// Then on fetch:
if (this.sessionToken) hdrs["Authorization"] = `Bearer ${this.sessionToken}`;
```

### 4. Validation: 400 on encrypted requests

**Symptom:** `POST /api/relay/2 400 "id, method, and path are required"`

Encrypted relay requests have `{id, encrypted, payload}` — method/path are inside the encrypted payload, not in the outer envelope.

**Fix** (`api/internal/handlers/relay.go`):
```go
if !req.Encrypted && (req.Method == "" || req.Path == "") {
    // only validate cleartext requests
}
```

### 5. SQLite: missing x25519_public_key column

**Symptom:** Agent logs `E2E: no cipher available: no paired users with X25519 keys` despite successful pairing.

`CREATE TABLE IF NOT EXISTS` doesn't add columns to existing tables. The x25519_public_key column was in the schema definition but the table pre-dated the E2E feature.

**Fix** (`agent/internal/storage/sqlite.go`):
```go
// Migrations: add columns that may not exist in older databases
db.Exec(`ALTER TABLE authorized_keys ADD COLUMN x25519_public_key BLOB`)
```

### 6. Response: empty JSON from relay

**Symptom:** `Failed to execute 'json' on 'Response': Unexpected end of JSON input`

The API relay handler decomposed responses into HTTP status/headers/body, but encrypted responses only have `{id, encrypted, payload}` — no status/headers/body. The body was empty.

**Fix:** Unified relay to always return JSON envelope. SDK always parses envelope:
```go
// api/internal/handlers/relay.go
writeJSON(w, http.StatusOK, resp)
```
```typescript
// sdk/src/index.ts — always parse envelope
const resJson = await res.json();
return new Response(resJson.body, { status: resJson.status, headers: resJson.headers || {} });
```

### 7. Sandbox: prompt() blocked

**Symptom:** `Ignored call to 'prompt()'. The document is sandboxed, and the 'allow-modals' keyword is not set.`

**Fix:** Replaced `prompt()` with inline `<input>` + button using `addEventListener`.

## Key Insight

**Each layer has one job.** Don't duplicate or conflict between layers:

| Layer | Job |
|-------|-----|
| `sandbox="allow-scripts"` | Isolation boundary (no same-origin, no modals, no cookies) |
| Relay API | Pure pipe — pass JSON envelope through unchanged |
| E2E encryption | Confidentiality — server never sees plaintext |
| CSP | Redundant inside sandbox — keep simple with `unsafe-inline` |
| Auth | Bearer token via URL param extraction (cookies don't work) |

## Prevention Checklist

When working with sandboxed iframes + relay:

- [ ] Add `"null"` to CORS AllowedOrigins
- [ ] Don't use CSP nonces inside sandboxed iframes — use `unsafe-inline`
- [ ] Extract auth tokens from URL params, send as Bearer header
- [ ] Skip inner-field validation on encrypted requests (they're opaque)
- [ ] Write ALTER TABLE migrations for new columns on existing tables
- [ ] Return consistent JSON envelope from relay (don't decompose)
- [ ] Never use `alert()`, `confirm()`, `prompt()` — use inline UI
- [ ] Restart agent container after API rebuild (WebSocket reconnect)

## Related

- [Sandboxed Iframe SDK Delivery with Keypair Relay](sandboxed-iframe-sdk-delivery-with-keypair-relay.md)
- [WebSocket Relay Plan](../../plans/2026-03-05-feat-agent-websocket-relay-with-e2e-encryption-plan.md)
- [Security: Agent Key Revocation](../security-issues/incomplete-agent-key-revocation-on-removal.md)

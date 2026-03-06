---
title: "Remove Ed25519 signing (RFC 9421) — X25519 as sole key type"
date: 2026-03-06
tags:
  - security
  - refactoring
  - authentication
  - encryption
  - x25519
  - e2e
category: refactoring
severity: high
components:
  - agent-backend
  - web-frontend
  - sdk
  - relay-router
  - database-schema
symptoms:
  - Ed25519 keypairs generated and stored unnecessarily
  - RFC 9421 HTTP Message Signatures never used in relay-only architecture
  - Redundant signing infrastructure competing with E2E encryption
  - Two key types (Ed25519 + X25519) creating unnecessary complexity
root_cause: >
  Original architecture used Ed25519 for RFC 9421 HTTP signatures on direct-mode
  agent requests. After migrating to relay-only architecture with E2E encryption
  (X25519 ECDH + HKDF-SHA256 + AES-256-GCM), Ed25519 became dead code.
  E2E decryption success provides implicit authentication — if decryption succeeds,
  the sender must possess the paired X25519 private key.
status: completed
related:
  - docs/plans/2026-03-05-feat-agent-websocket-relay-with-e2e-encryption-plan.md
  - docs/solutions/integration-issues/e2e-encrypted-relay-agent-sandboxed-iframe-integration.md
  - docs/solutions/security-issues/incomplete-agent-key-revocation-on-removal.md
  - docs/plans/2026-03-05-refactor-remove-direct-mode-relay-only-plan.md
---

# Remove Ed25519 Signing (RFC 9421) — X25519 as Sole Key Type

## Problem

The codebase maintained two key types:

- **Ed25519**: RFC 9421 HTTP Message Signatures on every agent API request
- **X25519**: E2E encryption of relay messages (ECDH + HKDF-SHA256 + AES-256-GCM)

After migrating to relay-only architecture, all browser-to-agent communication passes through E2E encrypted relay. Ed25519 signing was dead code — E2E decryption already provides implicit authentication.

## Root Cause

Ed25519 was introduced for direct-mode HTTP agent communication (RFC 9421 signatures verified server-side). When E2E encrypted relay replaced direct mode, the signing infrastructure became redundant but was never removed.

## Solution

Remove Ed25519 entirely. Use X25519 public key as the sole user identifier. Authentication is implicit: successful AES-256-GCM decryption proves the sender possesses the paired X25519 private key.

### Key Changes

#### 1. Agent DB Schema (`agent/internal/storage/sqlite.go`)

```sql
-- Before (Ed25519)
CREATE TABLE authorized_keys (
    public_key TEXT PRIMARY KEY,  -- Ed25519
    username TEXT NOT NULL
);

-- After (X25519)
CREATE TABLE authorized_keys (
    x25519_public_key BLOB NOT NULL PRIMARY KEY,  -- 32-byte X25519 key
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Auto-migration: `needsMigration()` uses `PRAGMA table_info` to detect old `public_key` column, drops and recreates. User must re-pair (~30 seconds).

In-memory cache keys changed from Ed25519 base64 to X25519 base64url-encoded key IDs.

#### 2. Pairing Handler (`agent/internal/handlers/pair.go`)

Pairing request simplified from `{pairing_code, user_public_key, user_x25519_public_key, username}` to `{pairing_code, user_x25519_public_key, username}`.

Key revocation now reads `X-Yourbro-Key-ID` header (injected by relay router after E2E decryption) instead of extracting identity from RFC 9421 signature middleware context.

#### 3. Relay Router (`agent/internal/relay/router.go`)

After E2E decryption, injects `X-Yourbro-Key-ID: <key_id>` header into the inner HTTP request. This lets downstream handlers identify the authenticated user without middleware.

Removed: `crypto/tls` import, `httpReq.TLS` hack, `httpReq.RequestURI` hack (all were workarounds for RFC 9421 signature verification in relay context).

#### 4. Auth Middleware — Deleted

`agent/internal/middleware/auth.go` — deleted entirely (contained `VerifyUserSignature`, nonce cache, context helpers).

`agent/internal/middleware/auth_test.go` and `agent/internal/testutil/testutil.go` — deleted.

CORS config: removed `Signature-Input`, `Signature`, `Content-Digest` from AllowedHeaders.

#### 5. Agent Routes (`agent/cmd/server/main.go`)

Removed middleware-protected route groups. Added simple endpoints:
- `POST /api/auth-check` — returns `{"status":"paired"}` (no middleware, auth is via E2E relay)
- `POST /api/revoke-key` — reads `X-Yourbro-Key-ID` header

#### 6. Browser E2E Library (`web/src/lib/e2e.ts` — new)

Shared E2E helpers extracted from shell.html pattern:
- `deriveE2EKey(privateKey, agentPubKeyBytes)` — X25519 ECDH + HKDF-SHA256 to AES-256-GCM key
- `e2eEncrypt(aesKey, plaintext)` / `e2eDecrypt(aesKey, data)` — IV(12) + ciphertext
- `encryptedRelay(agentId, aesKey, userKeyId, innerReq)` — full E2E relay fetch wrapper
- `x25519KeyId(publicKeyBytes)` — base64url key ID

#### 7. Dashboard (`web/src/pages/dashboard.ts`)

Removed: `signRelayRequest()`, all RFC 9421 signing, `getOrCreateKeypair` (Ed25519).

Added: `probeAgentPairing()` — checks IndexedDB for agent X25519 key, derives E2E key, sends encrypted probe to `/api/auth-check`.

Pairing sends only `user_x25519_public_key`. Page deletion and key revocation use `encryptedRelay()`.

#### 8. Web Crypto (`web/src/lib/crypto.ts`)

Removed: `StoredKeypair` (Ed25519), `getOrCreateKeypair()`.
Kept: `StoredX25519Keypair`, `getOrCreateX25519Keypair()`, agent key storage, base64 utilities.

#### 9. SDK (`sdk/src/crypto.ts`, `sdk/src/index.ts`)

Changed from Ed25519 to X25519 keypair generation. Removed all RFC 9421 signing from `relayRequest()`. Now sends E2E encrypted requests with `key_id` field.

### Cryptographic Constants

| Parameter | Value |
|-----------|-------|
| Key Exchange | X25519 ECDH |
| KDF | HKDF-SHA256 (RFC 5869) |
| KDF Salt | nil (zero salt) |
| KDF Info | `"yourbro-e2e-v1"` |
| Symmetric Cipher | AES-256-GCM |
| Key Size | 256 bits (32 bytes) |
| Nonce/IV | 12 bytes, random per message |

## Files Changed

| File | Action |
|------|--------|
| `agent/internal/storage/sqlite.go` | Modified — X25519 schema, migration |
| `agent/internal/storage/sqlite_test.go` | Modified — X25519 tests |
| `agent/internal/handlers/pair.go` | Modified — X25519-only pairing |
| `agent/internal/handlers/pair_test.go` | Rewritten — local test helpers |
| `agent/internal/handlers/integration_test.go` | Rewritten — no auth middleware |
| `agent/cmd/server/main.go` | Modified — new routes, removed middleware |
| `agent/internal/relay/router.go` | Modified — key_id injection, cleanup |
| `agent/internal/middleware/auth.go` | Deleted |
| `agent/internal/middleware/auth_test.go` | Deleted |
| `agent/internal/middleware/cors.go` | Modified — removed RFC 9421 headers |
| `agent/internal/testutil/testutil.go` | Deleted |
| `web/src/lib/e2e.ts` | Created — shared E2E helpers |
| `web/src/lib/crypto.ts` | Modified — removed Ed25519 |
| `web/src/lib/crypto.test.ts` | Modified — X25519 tests |
| `web/src/pages/dashboard.ts` | Modified — E2E probing, removed signing |
| `web/src/pages/how-to-use.ts` | Modified — updated descriptions |
| `web/src/pages/login.ts` | Modified — updated descriptions |
| `sdk/src/crypto.ts` | Modified — X25519 keypair |
| `sdk/src/index.ts` | Modified — removed RFC 9421 signing |
| `README.md`, `SKILL.md`, `CLAUDE.md` | Modified — updated docs |

## Prevention

### Avoid Re-introducing Signing

E2E decryption is the sole auth mechanism. Do NOT add supplementary signatures, HMAC, or per-request tokens. If decryption succeeds, the sender is authenticated — this is cryptographically sufficient for yourbro's threat model (agent runs on user's own machine).

### Key Principles

1. **Decryption success = authentication** — no supplementary tokens/signatures needed
2. **Single key type** — X25519 for both encryption and identity
3. **Key ID from relay router only** — `X-Yourbro-Key-ID` must be injected after E2E decryption, never accepted from URL/query params
4. **Identical error messages** — all decryption failures return the same error to prevent key enumeration
5. **No persistent AES keys** — cipher cache is in-memory, cleared on restart

### Linter Checks

Flag any new code importing `crypto/ed25519`, `crypto/rsa`, or adding `Signature-Input`/`Signature` headers. These are indicators of re-introduced signing.

### Schema Guard

The `authorized_keys` table should only have `x25519_public_key BLOB` as its key column. Reject migrations adding Ed25519 or other key type columns.

## Verification

1. Rebuild agent: `docker compose -f docker-compose.agent-prod.yml up --build`
2. Agent logs migration message if upgrading from old schema
3. Dashboard shows agent as unpaired after migration
4. Enter pairing code — pairs (only X25519 exchanged)
5. Visit `/p/{username}/{slug}` — page loads via E2E relay
6. Storage bridge works (postMessage set/get)
7. `strings yourbro-agent | grep -i ed25519` — empty

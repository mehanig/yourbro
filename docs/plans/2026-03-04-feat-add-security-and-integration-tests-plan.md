---
title: "feat: Add security and integration tests for agent, middleware, and web crypto"
type: feat
status: active
date: 2026-03-04
---

# feat: Add security and integration tests

## Problem Statement

The yourbro project has zero tests. No `_test.go` files, no `*.test.ts` files, no test frameworks installed. The codebase has security-critical code (RFC 9421 signature verification, Ed25519 key management, pairing codes, key revocation) that needs test coverage. Additionally, the SpecFlow analysis found a real security gap: **Content-Digest is included in the signature base but never verified against the actual request body**.

## Proposed Solution

Add test infrastructure and comprehensive tests in two phases:

1. **Go tests** (agent) — security middleware, pairing handler, storage, key revocation
2. **TypeScript tests** (web) — crypto utilities, RFC 9421 signing, cross-language interop

### Approach

- **Go**: Standard library only (`testing`, `net/http/httptest`). No testify. In-memory SQLite (`:memory:`) for isolation.
- **TypeScript**: Vitest with Node.js environment. Node 20+ has native Ed25519 WebCrypto support — no polyfills needed. Use `fake-indexeddb` for IndexedDB mocking.
- **No browser tests** in Phase 1. Node's `crypto.subtle` is identical to browser WebCrypto for Ed25519.

## Security Bug Found During Analysis

**Content-Digest not verified against body** (`agent/internal/middleware/auth.go:176-178`):

The middleware reads `r.Header.Get("Content-Digest")` and includes it in the signature base, but **never verifies the digest matches the actual request body hash**. An attacker can send a valid signature over a fake Content-Digest with a different body.

**Fix**: Add body hash verification in the middleware before signature verification. This should be fixed as part of this work.

## Phase 1: Go Tests (Agent)

### 1.1 Test Helper — `agent/internal/testutil/testutil.go`

```go
package testutil

func NewTestDB(t *testing.T) *storage.DB       // in-memory SQLite
func TestKeypair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey)
func SignRequest(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey)
func SignRequestWithTime(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, created time.Time)
func SignRequestWithNonce(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, nonce string)
func SignRequestWithBody(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, body string)
```

### 1.2 Storage Tests — `agent/internal/storage/sqlite_test.go`

| Test | Description |
|------|-------------|
| `TestNewDB_InMemory` | Creates tables, returns valid DB |
| `TestAuthorizedKeys_AddAndCheck` | Add key, verify `IsKeyAuthorized` returns true |
| `TestAuthorizedKeys_Delete` | Delete key, verify `IsKeyAuthorized` returns false |
| `TestAuthorizedKeys_DeleteReloadsCache` | Delete, immediate check fails (cache reloaded) |
| `TestAuthorizedKeys_DuplicateKey` | INSERT OR REPLACE updates username |
| `TestStorage_SetAndGet` | Round-trip value |
| `TestStorage_Upsert` | Set same key twice, value updated |
| `TestStorage_Delete` | Delete entry, Get returns error |
| `TestStorage_DeleteNonexistent` | No error |
| `TestStorage_List` | Returns all entries ordered by key |
| `TestStorage_ListWithPrefix` | Filters by prefix |
| `TestStorage_ListPrefixEscaping` | Prefix with `%` and `_` — LIKE wildcards escaped |
| `TestStorage_ListEmpty` | Returns nil/empty slice |

### 1.3 Middleware Tests — `agent/internal/middleware/auth_test.go`

Table-driven tests for `VerifyUserSignature`:

**Happy path:**
- Valid GET signature (no body) → 200, username + publicKey in context
- Valid PUT signature with Content-Digest → 200

**Rejection tests:**
- Missing Signature-Input header → 401
- Missing Signature header → 401
- Malformed Signature-Input (no `=`) → 401
- Missing keyid/created/nonce params → 401
- Non-numeric created → 401
- Timestamp too old (now - 301s) → 401
- Timestamp too far in future (now + 301s) → 401
- Timestamp at exact boundary (now - 300s) → 200 (passes)
- Replayed nonce → 401
- Invalid keyid (bad base64) → 401
- Invalid keyid (wrong length) → 401
- Invalid signature encoding → 401
- Cryptographically invalid signature (wrong key) → 401
- Valid signature but unauthorized key → 403

**Security-critical:**
- **Timing oracle prevention**: invalid signature + unauthorized key → 401 (not 403). Proves signature check happens before authorization.
- **Nonce replay within TTL**: same nonce twice → second rejected
- **Concurrent nonce submission**: two goroutines, same nonce, exactly one succeeds

**Nonce cache tests:**
- `TestNonceCache_Seen` — new nonce returns false, repeat returns true
- `TestNonceCache_Pruning` — entries older than TTL are pruned
- `TestNonceCache_ConcurrentAccess` — no races under `t.Parallel()`

### 1.4 Pairing Handler Tests — `agent/internal/handlers/pair_test.go`

| Test | Expected |
|------|----------|
| Valid pairing (correct code, valid key, username) | 200, key stored |
| Wrong pairing code | 401 |
| Pairing code already used | 410 |
| Pairing code expired | 410 |
| Rate limit (6th attempt) | 429 |
| Invalid JSON body | 400 |
| Invalid public key (bad base64) | 400 |
| Invalid public key (wrong length, e.g. 16 bytes) | 400 |
| Empty username | 400 |
| Rate limit persists: 5 wrong + 1 correct = 429 | 429 on 6th |

### 1.5 Key Revocation Tests — `agent/internal/handlers/pair_test.go`

| Test | Expected |
|------|----------|
| Successful revocation (signed DELETE) | 200, key removed |
| Key actually deleted from authorized_keys | `IsKeyAuthorized` returns false |
| Subsequent signed request with revoked key | 403 |
| Key owner isolation: User A cannot revoke User B's key | By design — middleware sets public key from signature |

### 1.6 Integration Tests — `agent/internal/handlers/integration_test.go`

| Test | Flow |
|------|------|
| Full lifecycle | Pair → Set → Get → List → Delete → Verify |
| Pair then revoke then access denied | Pair → Set (works) → Revoke → Set (403) |
| Multiple users isolated | Pair user A → Pair user B → A's data invisible to B |
| Storage isolation between slugs | Set "foo" under slug-a and slug-b → independent |

### 1.7 Fix Content-Digest Verification — `agent/internal/middleware/auth.go`

Before signature verification, if `content-digest` is in covered components and the request has a body:
1. Read and buffer the body
2. Compute SHA-256 hash
3. Compare against the Content-Digest header value
4. If mismatch, return 400 "content-digest mismatch"
5. Replace `r.Body` with a reader over the buffered body

Test: Send valid signature but Content-Digest doesn't match body → rejected.

## Phase 2: TypeScript Tests (Web)

### 2.1 Setup — `web/vitest.config.ts` + `web/vitest.setup.ts`

```bash
cd web && npm install -D vitest fake-indexeddb
```

`vitest.setup.ts`:
```typescript
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto as any;
}
```

`vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { setupFiles: ["./vitest.setup.ts"] },
});
```

Add to `web/package.json`:
```json
{ "scripts": { "test": "vitest run" } }
```

### 2.2 Crypto Tests — `web/src/lib/crypto.test.ts`

| Test | Description |
|------|-------------|
| `getOrCreateKeypair` generates valid 32-byte public key | First call creates keypair |
| `getOrCreateKeypair` returns same keypair on second call | IndexedDB persistence |
| `base64RawUrlEncode` produces URL-safe output | No `+`, `/`, `=` characters |
| `base64StdEncode` produces standard base64 | Correct padding |
| `signedFetch` sets Signature-Input header | Contains `sig1=`, keyid, created, nonce |
| `signedFetch` sets Signature header | Format `sig1=:base64:` |
| `signedFetch` without body omits Content-Digest | Only `@method` and `@target-uri` |
| `signedFetch` with body includes Content-Digest | SHA-256 hash in header |
| Private key is non-extractable | `exportKey("pkcs8", privateKey)` throws |

### 2.3 Cross-Language Interop Test — `agent/internal/handlers/interop_test.go`

This is the most important test. Generate known test vectors:

1. Hard-code a test Ed25519 keypair (same bytes in Go and TS)
2. Construct a signature base string
3. Sign it with the private key
4. Verify the Go middleware accepts it

This proves the TS `signedFetch` and Go `VerifyUserSignature` agree on format.

## Acceptance Criteria

- [ ] Go agent builds and all tests pass (`cd agent && go test ./...`)
- [ ] Web tests pass (`cd web && npm test`)
- [ ] Content-Digest verification bug fixed and tested
- [ ] Middleware security tests cover: missing headers, invalid signatures, expired timestamps, replayed nonces, unauthorized keys, timing oracle prevention
- [ ] Pairing tests cover: valid pairing, wrong code, expired code, rate limiting, invalid key format
- [ ] Key revocation tests cover: successful revocation, subsequent access denied
- [ ] Storage tests cover: CRUD, prefix filtering, LIKE escaping
- [ ] Integration test covers full pair → store → revoke → deny lifecycle
- [ ] TS tests cover: keypair generation, base64 encoding, signedFetch headers
- [ ] Makefile has `test` target

## Files to Create/Modify

| File | Change |
|------|--------|
| `agent/internal/testutil/testutil.go` | NEW — test helpers (DB, keypair, request signing) |
| `agent/internal/storage/sqlite_test.go` | NEW — storage unit tests |
| `agent/internal/middleware/auth_test.go` | NEW — middleware security tests |
| `agent/internal/handlers/pair_test.go` | NEW — pairing + revocation tests |
| `agent/internal/handlers/storage_test.go` | NEW — storage handler tests |
| `agent/internal/handlers/integration_test.go` | NEW — full lifecycle tests |
| `agent/internal/middleware/auth.go` | MODIFY — fix Content-Digest verification |
| `web/vitest.config.ts` | NEW — vitest config |
| `web/vitest.setup.ts` | NEW — WebCrypto + fake-indexeddb setup |
| `web/src/lib/crypto.test.ts` | NEW — crypto unit tests |
| `web/package.json` | MODIFY — add vitest, fake-indexeddb, test script |
| `Makefile` | MODIFY — add `test` target |

## Context

- Agent auth: RFC 9421 HTTP Message Signatures with Ed25519 — `agent/internal/middleware/auth.go`
- Authorized keys: SQLite with in-memory cache — `agent/internal/storage/sqlite.go`
- Pairing: One-time code + public key exchange — `agent/internal/handlers/pair.go`
- Web crypto: Ed25519 keypair + RFC 9421 signing — `web/src/lib/crypto.ts`
- SDK signing: `sdk/src/index.ts:96-145`
- Existing security solutions: `docs/solutions/security-issues/incomplete-agent-key-revocation-on-removal.md`

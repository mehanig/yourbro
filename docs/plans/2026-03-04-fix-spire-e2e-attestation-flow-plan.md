---
title: Zero-Trust Agent Auth — User Signs, Server is Untrusted Broker
type: feat
status: active
date: 2026-03-04
deepened: 2026-03-04
---

## Enhancement Summary

**Deepened on:** 2026-03-04
**Agents used:** security-sentinel, architecture-strategist, performance-oracle, code-simplicity-reviewer, agent-native-reviewer, best-practices-researcher, framework-docs-researcher, data-integrity-guardian, pattern-recognition-specialist

### Key Improvements from Research
1. **Use RFC 9421 HTTP Message Signatures** — industry standard, not custom signing format
2. **Add nonce to signed payload** — prevents replay attacks within timestamp window
3. **Eliminate `agents` table** — YAGNI, `agent_endpoint` already on `pages` table
4. **Cache keypair in memory** — IndexedDB is the dominant perf bottleneck, not crypto
5. **Increase pairing code to 8 chars with 5-min expiry** — insufficient entropy at 6 chars
6. **Add headless agent access** — `POST /api/pages/{id}/token` for CLI/CI access
7. **Fix existing security bugs** — CSP, iframe sandbox, CORS headers, slug validation

### New Risks Discovered
- iframe `sandbox="allow-scripts allow-same-origin"` allows sandbox escape → serve content from separate origin
- CSP allows `unsafe-inline` + `unsafe-eval` → XSS vector on user-published HTML
- `test-private.key` committed to repo → must be removed and rotated
- WebCrypto `extractable: false` applies to BOTH keys → must export pubkey first, then re-import private as non-extractable

---

# Zero-Trust Agent Auth — User Signs, Server is Untrusted Broker

## Overview

Replace SPIRE/SPIFFE with a direct user-to-agent trust model where the yourbro server is an **untrusted broker**. The server can't read agent data, can't forge auth, and admins can't snoop. Auth flows directly between the user's browser and their agent via Ed25519 signatures following [RFC 9421 HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421).

## Threat Model

| Threat | Mitigated? | How |
|--------|-----------|-----|
| Agent A compromised → reads Agent B | Yes | Separate SQLite, separate keys, no shared secrets |
| Yourbro DB dump | Yes | DB has only public keys + page metadata, zero user data |
| Yourbro admin snoops | Yes | Server never has auth material to forge agent requests |
| Server compromise (passive) | Yes | Can't forge user signatures, can't read agent data |
| Server compromise (active JS injection) | Partial | WebCrypto non-extractable keys prevent key *theft*; malicious JS can still *use* the key while tab is open. Full protection requires native app or browser extension. See "Limitations" section. |

## Architecture

```
SETUP (one-time pairing):

User's Browser                     Agent Machine
┌─────────────────┐               ┌─────────────────┐
│ Generate Ed25519│               │ Generate pairing │
│ keypair via     │               │ code (8 chars)   │
│ WebCrypto       │               │ with 5-min expiry│
│                 │               │                 │
│ POST /api/pair ─┼──── direct ──>│ Verify code     │
│ {code, user_pub}│  (no server)  │ Store user's    │
│                 │               │ public key      │
│                 │               │                 │
│                 │    yourbro.ai (just a broker)   │
│ page metadata   │<─────────────>│                 │
└─────────────────┘               └─────────────────┘

RUNTIME (every request, per RFC 9421):

Browser                              Agent
   │                                    │
   │── Signature-Input: sig1=(...)  ───>│
   │   Signature: sig1=:base64sig:      │── verify Ed25519 sig against
   │   Content-Digest: sha-256=:...:    │   stored authorized pubkeys
   │                                    │── check created timestamp ±5min
   │                                    │── check nonce not replayed
   │                                    │── check keyid is authorized
   │<── JSON data ──────────────────────│

   Server is NOT in the auth path.
   Server only serves page HTML with agent endpoint URL.
```

## Key Design Decisions

1. **RFC 9421 HTTP Message Signatures** — use the IETF standard for per-request signing, not a custom format. This ensures interoperability and gets replay protection right (created + nonce). Libraries: `httpsig` (npm), `github.com/common-fate/httpsig` (Go).

2. **WebCrypto Ed25519 non-extractable keys** — browser generates keypair, stores in IndexedDB. Private key never leaves the browser's crypto subsystem. **Gotcha**: generate with `extractable: true`, export public key, then re-import private key as non-extractable (both keys share the extractable flag).

3. **Direct pairing** — browser sends public key directly to agent, verified by a one-time 8-character pairing code with 5-minute expiry. Server never handles user-to-agent auth keys.

4. **Per-request signing with nonce** — every SDK request signs `{@method, @target-uri, content-digest, created, nonce}`. Agent verifies signature, checks nonce hasn't been used (LRU cache, 5-min TTL), checks timestamp freshness. No sessions, no tokens, no cookies.

5. **Server is metadata-only** — stores page slugs, agent endpoints, user profiles. Has zero cryptographic ability to impersonate users to agents.

6. **Drop SPIRE entirely** — SPIRE solves service-mesh identity. Our problem is user-to-agent trust. Different problem, simpler solution.

---

## Phase 1: Delete SPIRE + Fix Existing Security Bugs

### Delete files:
- `spire/` — entire directory
- `Dockerfile.spire`, `Dockerfile.spire-agent`
- `deploy/spire-agent-entrypoint.sh`
- `skill/templates/server.conf.template`, `agent.conf.template`
- `skill/scripts/install-identity.sh`
- `test-private.key` — **CRITICAL: committed secret material, add `*.key` to `.gitignore`**

### Modify files:
- `docker-compose.prod.yml` — remove `spire-server` service, `spire-data` volume
- `docker-compose.agent.yml` — remove `spire-agent` service, simplify to just `agent-server`
- `docker-compose.local.yml` — remove SPIRE refs
- `Makefile` — remove `build-spire` targets
- `.env.example` — remove `SPIRE_*`, `SERVER_SIGNING_KEY`, `SERVER_PUBLIC_KEY` vars
- `.gitignore` — add `*.key`, `*.pem`, `test-private.*`

### Fix existing security bugs:
- **CSP**: Replace `'unsafe-inline' 'unsafe-eval'` with nonce-based `script-src` in `api/internal/handlers/pages.go:172`
- **iframe sandbox**: Remove `allow-same-origin` from `sandbox` attribute (line 279). Serve page content from a separate origin long-term (`content.yourbro.ai`).
- **Scope mismatch**: Fix `ValidScopes` in `api/internal/models/models.go` — either add `write:storage`/`read:storage` or remove from dashboard `web/src/pages/dashboard.ts:118-121`
- **Internal API bypass**: In `api/cmd/server/main.go:190`, deny access when `YOURBRO_INTERNAL_KEY` is empty, don't silently skip auth

### Remove from server:
- `loadOrGenerateSigningKey()`, `SigningKey`, `SigningPubKey` from `PagesHandler`
- `signPageToken()`, `ServerPublicKey()` handlers
- `/api/server-public-key` route
- `/api/internal/verify-key` route (zero callers after SPIRE removal)
- `SERVER_SIGNING_KEY` env var handling

### Research Insight: Timing side-channel
> The signature verification order matters. Always perform full Ed25519.Verify() before checking if the key is authorized. Otherwise, response time leaks whether a public key is in the authorized_keys table. — *Security Sentinel*

---

## Phase 2: Agent Pairing + Auth Middleware

### `agent/internal/handlers/pair.go` (new)

```go
// POST /api/pair
// Body: {"pairing_code": "A7X3KP9M", "user_public_key": "base64...", "username": "mehanig"}
// No auth required — pairing code IS the auth.
// Rate limited: 5 attempts total per code, exponential backoff, 5-minute expiry.
func (h *PairHandler) Pair(w http.ResponseWriter, r *http.Request) {
    // 1. Read body with size limit (4KB max)
    // 2. Constant-time compare pairing code (subtle.ConstantTimeCompare)
    // 3. Check code not expired (5-minute TTL)
    // 4. Check attempt count < 5, apply exponential backoff
    // 5. Validate public key: base64.RawURLEncoding → 32 bytes
    // 6. Store {username, public_key} in authorized_keys table
    // 7. Invalidate pairing code (one-time use)
    // 8. Return {status: "paired"}
}
```

### Research Insight: Pairing code best practices
> Use `crypto/rand` with 8-character codes from `[a-zA-Z0-9]` (62^8 = ~218 trillion combinations). Auto-expire after 5 minutes. Use constant-time comparison (`subtle.ConstantTimeCompare`). Implement global rate limit (not per-IP). Log all attempts for audit. — *Best Practices Researcher*

### `agent/internal/middleware/auth.go` (rewrite)

Replace page-token verification with RFC 9421 signature verification:

```go
func VerifyUserSignature(store *storage.SQLite) func(http.Handler) http.Handler {
    nonceCache := NewNonceCache(5 * time.Minute)

    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            sigInput := r.Header.Get("Signature-Input")
            sig := r.Header.Get("Signature")

            // 1. Parse Signature-Input: extract keyid, created, nonce, covered components
            // 2. Check created timestamp ±5 min
            // 3. Check nonce not in cache (replay protection)
            // 4. Reconstruct signature base per RFC 9421
            // 5. Decode public key from keyid (base64 raw-URL → 32 bytes)
            // 6. Verify Ed25519 signature (ALWAYS verify before checking authorization)
            // 7. Check public key is in authorized_keys table
            // 8. Validate slug from covered components matches URL parameter
            // 9. Store nonce in cache
            // 10. Set username in context
            next.ServeHTTP(w, r)
        })
    }
}
```

### Research Insight: Nonce cache for replay protection
> A timestamp-only scheme allows replay within the 5-minute window. Add a nonce (UUID) per request. Agent maintains an LRU cache of seen nonces (bounded, e.g. 10,000 entries) that expire after 5 minutes. This eliminates replay entirely. — *Architecture Strategist + Security Sentinel*

### Research Insight: Verification order prevents timing oracle
> Always: parse → reconstruct payload → **verify signature** → **then** check if key is authorized. If you check authorization first, response time reveals whether a key exists. — *Security Sentinel*

### `agent/internal/storage/sqlite.go` — new table + fixes

```sql
CREATE TABLE authorized_keys (
    public_key TEXT NOT NULL PRIMARY KEY,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Methods: `AddAuthorizedKey(publicKey, username)`, `IsKeyAuthorized(publicKey) (username, bool)`.

### Research Insight: Simplification
> `RemoveAuthorizedKey` and `GetAuthorizedKeys` are YAGNI for v1. Only `Add` and `IsAuthorized` are needed now. The `config` table is also unnecessary — generate pairing code in memory, regenerate on restart. — *Simplicity Reviewer*

### Research Insight: Performance — cache authorized keys in Go memory
> Even with an indexed SQLite lookup (~0.01ms), cache authorized keys in a `sync.RWMutex` map for zero-overhead auth. Reload on `AddAuthorizedKey`. This eliminates SQLite from the hot path entirely. — *Performance Oracle*

### Fix: LIKE injection in `List` method

```go
escaped := strings.NewReplacer("%", "\\%", "_", "\\_").Replace(prefix)
rows, err := s.db.QueryContext(ctx,
    `SELECT key, value_json, updated_at FROM storage WHERE page_slug = ? AND key LIKE ? ESCAPE '\'`,
    pageSlug, escaped+"%")
```

### Fix: CORS headers

```go
AllowedHeaders: []string{"Content-Type", "Signature-Input", "Signature", "Content-Digest"},
AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
```

---

## Phase 3: Browser Crypto + SDK Request Signing

### `sdk/src/crypto.ts` (new)

```typescript
// Generate keypair — export pubkey first, then lock private key
export async function getOrCreateKeypair(): Promise<{
  privateKey: CryptoKey;
  publicKeyBytes: Uint8Array;
}> {
  // Check IndexedDB cache first
  const cached = await loadFromIndexedDB();
  if (cached) return cached;

  // Generate extractable first (both keys share the flag)
  const temp = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);

  // Export public key as raw bytes (32 bytes)
  const pubRaw = await crypto.subtle.exportKey("raw", temp.publicKey);
  const publicKeyBytes = new Uint8Array(pubRaw);

  // Re-import private key as NON-extractable
  const privPkcs8 = await crypto.subtle.exportKey("pkcs8", temp.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8", privPkcs8, "Ed25519", false, ["sign"]
  );

  // Zero out exported private key material (best effort)
  new Uint8Array(privPkcs8).fill(0);

  // Store in IndexedDB (CryptoKey is structured-cloneable)
  await saveToIndexedDB(privateKey, publicKeyBytes);
  return { privateKey, publicKeyBytes };
}
```

### Research Insight: WebCrypto non-extractable key gotcha
> When `extractable: false` is passed to `generateKey()`, BOTH the public and private key may be non-extractable in some implementations. The safe pattern is: generate extractable → export public key → re-import private as non-extractable → zero the exported material. — *Framework Docs Researcher + Best Practices Researcher*

### Research Insight: Browser compatibility
> Ed25519 WebCrypto: Chrome 113+ (May 2023), Firefox 130+ (Sept 2024), Safari 17+ (Sept 2023). All major browsers support it as of 2025. Add feature detection: wrap `generateKey` in try/catch, show clear error for unsupported browsers. — *Framework Docs Researcher*

### `sdk/src/index.ts` (rewrite)

```typescript
export class ClawdStorage {
  private agentEndpoint: string;
  private pageSlug: string;
  // Cache in memory — IndexedDB is the perf bottleneck, not crypto
  private cachedPrivateKey: CryptoKey | null = null;
  private cachedPubKeyB64: string | null = null;
  private initPromise: Promise<void> | null = null;

  static async init(): Promise<ClawdStorage> {
    const endpoint = getMeta('clawd-agent-endpoint');
    const slug = getMeta('clawd-page-slug');
    const instance = new ClawdStorage(endpoint, slug);
    await instance.ensureKeys();
    return instance;
  }

  private async ensureKeys(): Promise<void> {
    if (this.cachedPrivateKey) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
      this.cachedPrivateKey = privateKey;
      this.cachedPubKeyB64 = base64RawUrlEncode(publicKeyBytes);
    })();
    return this.initPromise;
  }

  private async signedFetch(method: string, path: string, body?: string): Promise<Response> {
    await this.ensureKeys();
    const url = `${this.agentEndpoint}${path}`;
    const created = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();

    // Content-Digest for body (RFC 9530)
    let contentDigest = "";
    if (body) {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
      contentDigest = `sha-256=:${btoa(String.fromCharCode(...new Uint8Array(hash)))}:`;
    }

    // RFC 9421 signature base
    const coveredComponents = body
      ? '("@method" "@target-uri" "content-digest")'
      : '("@method" "@target-uri")';
    const sigParams = `${coveredComponents};created=${created};nonce="${nonce}";keyid="${this.cachedPubKeyB64}"`;

    const lines = [
      `"@method": ${method}`,
      `"@target-uri": ${url}`,
    ];
    if (contentDigest) lines.push(`"content-digest": ${contentDigest}`);
    lines.push(`"@signature-params": ${sigParams}`);
    const signatureBase = lines.join("\n");

    const sig = await crypto.subtle.sign("Ed25519", this.cachedPrivateKey!,
      new TextEncoder().encode(signatureBase));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Signature-Input": `sig1=${sigParams}`,
      "Signature": `sig1=:${sigB64}:`,
    };
    if (contentDigest) headers["Content-Digest"] = contentDigest;

    return fetch(url, { method, headers, body });
  }

  async get<T>(key: string): Promise<T | null> { ... }
  async set(key: string, value: unknown): Promise<boolean> { ... }
  async list(prefix?: string): Promise<string[]> { ... }
  async delete(key: string): Promise<boolean> { ... }
}
```

### Research Insight: Performance — cache keypair in memory
> IndexedDB reads cost 0.5-5ms per operation. Crypto operations cost ~0.1ms. Cache the keypair + exported public key in class properties. One IndexedDB read per page load, not per request. Also deduplicate concurrent init calls with a Promise. — *Performance Oracle*

### Research Insight: Sign body directly?
> The simplicity reviewer suggests signing the raw body instead of body_hash. However, RFC 9421 uses Content-Digest (RFC 9530) for body integrity, which is the correct standard approach. Stick with Content-Digest. — *Best Practices Researcher*

---

## Phase 4: Server API Updates + Page Rendering

### `api/internal/handlers/pages.go` — `RenderPageContent`

Still requires JWT auth (page ownership check), simplified:

```go
func (h *PagesHandler) RenderPageContent(w http.ResponseWriter, r *http.Request) {
    // 1. Validate JWT from ?token= query param
    // 2. Verify user owns the page
    // 3. Inject meta tags (only two):
    //    <meta name="clawd-agent-endpoint" content="https://...">
    //    <meta name="clawd-page-slug" content="my-page">
    // 4. CSP: connect-src includes agent endpoint
    // 5. Serve page HTML
}
```

**No more `clawd-page-token` meta tag.** The SDK handles auth via user keypair signatures.

### Research Insight: JWT in URL is a token leakage vector
> The `?token=` pattern leaks the 7-day JWT to logs, browser history, and Referer headers. For now this is acceptable (the JWT only authorizes content loading, not agent access). Long-term: switch to `postMessage` from parent to iframe, or use a short-lived single-use code. Set `Referrer-Policy: no-referrer` on the content endpoint. — *Security Sentinel*

### Add headless agent access endpoint

**`api/internal/handlers/pages.go`** — new handler:

```go
// POST /api/pages/{id}/content-meta
// Auth: Bearer token or JWT
// Returns: {"agent_endpoint": "...", "slug": "..."}
// This lets headless agents (CLI, CI, Claude) get the agent endpoint
// without rendering HTML in a browser.
```

### Research Insight: Agent-native parity
> Without this endpoint, AI agents and CLI tools have no way to discover the agent_endpoint for a page. The SKILL.md currently documents non-existent endpoints. Fix SKILL.md to describe the real flow. — *Agent-Native Reviewer*

### `web/src/pages/dashboard.ts` — "Pair Agent" UI

1. User clicks "Pair Agent"
2. Enters agent endpoint URL + pairing code (from agent terminal)
3. Dashboard calls `getOrCreateKeypair()`, exports public key
4. Sends directly to agent: `POST https://{agent_endpoint}/api/pair`
5. On success, shows confirmation with agent fingerprint

### Research Insight: No `agents` table needed
> The plan originally proposed an `agents` table in PostgreSQL. This is unnecessary — `agent_endpoint` is already on the `pages` table. The pairing flow proves the user controls the agent (via the pairing code). The server doesn't need a registry. Removing this eliminates a migration, a handler, and a validation step with no security loss. — *Simplicity Reviewer*

---

## Phase 5: Docker Compose + E2E Test

### `docker-compose.agent.yml` (simplified)

```yaml
services:
  agent-server:
    build:
      context: .
      dockerfile: Dockerfile.agent
    ports:
      - "${AGENT_PORT:-9443}:${AGENT_PORT:-9443}"
    volumes:
      - agent-data:/data
    environment:
      AGENT_DOMAIN: ${AGENT_DOMAIN:-}
      AGENT_PORT: ${AGENT_PORT:-9443}
      SQLITE_PATH: /data/agent.db
    restart: unless-stopped

volumes:
  agent-data:
```

### `docker-compose.prod.yml` — remove SPIRE

Remove `spire-server` service and `spire-data` volume.

### Database migration: `migrations/006_zero_trust_cleanup.sql`

```sql
-- Deprecate public_keys table (previously used for SPIRE attestation)
-- Phase 1: rename to signal deprecation, preserve data for rollback
ALTER TABLE IF EXISTS public_keys RENAME TO public_keys_deprecated;
```

### Research Insight: Data integrity
> Do not drop `public_keys` immediately. Rename to `public_keys_deprecated` first. Drop in a future migration (007) after confirming no code references remain. Also: add `ON DELETE CASCADE` to any FK referencing `users(id)` — currently implicit `NO ACTION` which blocks user deletion silently. — *Data Integrity Guardian*

### E2E Test Sequence

1. Start agent: `docker compose -f docker-compose.agent.yml up --build`
2. See pairing code in logs: `=== PAIRING CODE: A7X3KP9M (expires in 5 minutes) ===`
3. Login to yourbro, go to dashboard → "Pair Agent"
4. Enter agent URL + pairing code → pairing succeeds (browser keypair sent to agent)
5. Create page with `agent_endpoint` pointing to agent
6. Visit page → SDK auto-inits → read/write data works (RFC 9421 signed requests)
7. Open incognito → "Sign in to view this page" (no keypair = no access)
8. Compromise test: even with server DB dump, cannot forge Ed25519 signatures

---

## Security Hardening Checklist

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Remove `test-private.key` from repo, add to `.gitignore` | CRITICAL | Phase 1 |
| 2 | Fix CSP: remove `unsafe-inline`/`unsafe-eval` | CRITICAL | Phase 1 |
| 3 | Fix iframe sandbox: remove `allow-same-origin` | CRITICAL | Phase 1 |
| 4 | Add nonce to signed payload (replay protection) | HIGH | Phase 2 |
| 5 | Pairing code: 8 chars, 5-min expiry, exponential backoff | HIGH | Phase 2 |
| 6 | Update CORS `AllowedHeaders` for RFC 9421 headers | HIGH | Phase 2 |
| 7 | Slug validation: signature must cover slug, agent verifies match | HIGH | Phase 2 |
| 8 | Public key validation: 32-byte Ed25519, normalized encoding | MEDIUM | Phase 2 |
| 9 | LIKE injection escape in storage List | MEDIUM | Phase 2 |
| 10 | Timing: verify signature before checking authorization | MEDIUM | Phase 2 |
| 11 | Constant-time pairing code comparison | MEDIUM | Phase 2 |
| 12 | Body size limit on pairing endpoint (4KB) | LOW | Phase 2 |
| 13 | Audit logging for pairing attempts + auth failures | LOW | Phase 2 |
| 14 | Browser feature detection for Ed25519 WebCrypto | LOW | Phase 3 |

---

## What's NOT Changing

- Google OAuth login flow
- JWT session tokens for yourbro.ai API
- Page ownership model (user owns pages)
- Agent SQLite storage schema (page_slug, key, value_json)
- SDK public API (get, set, list, delete)
- Dockerfile.agent (agent data server image)

## Known Limitations

1. **Active JS injection**: A compromised server can serve malicious JS that uses the non-extractable key to sign forged requests while the tab is open. Full protection requires a native app or browser extension.
2. **Multi-device**: Each browser has its own keypair. New browsers need re-pairing. No key sync mechanism (like Signal's linked devices) — add later if needed.
3. **Key loss**: If user clears browser data, keypair is lost. Must re-pair with agent. Consider key backup/export mechanism for v2.
4. **IndexedDB in Safari**: Safari may clear IndexedDB after 7 days of non-use under ITP for third-party contexts. First-party contexts are safe.

## References

- [RFC 9421 — HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421)
- [RFC 9530 — Digest Fields (Content-Digest)](https://www.rfc-editor.org/rfc/rfc9530)
- [RFC 8032 — Ed25519](https://www.rfc-editor.org/rfc/rfc8032)
- [W3C WebCrypto API](https://www.w3.org/TR/WebCryptoAPI/)
- [MDN SubtleCrypto.sign() — Ed25519](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign#ed25519)
- [Ed25519 in Chrome (Igalia blog)](https://blogs.igalia.com/jfernandez/2025/08/25/ed25519-support-lands-in-chrome-what-it-means-for-developers-and-the-web/)
- [HTTP Message Signatures guide](https://victoronsoftware.com/posts/http-message-signatures/)
- `agent/internal/middleware/auth.go` — current auth (will be rewritten)
- `sdk/src/index.ts` — current SDK (will be rewritten)
- `api/internal/handlers/pages.go` — page rendering (will be simplified)

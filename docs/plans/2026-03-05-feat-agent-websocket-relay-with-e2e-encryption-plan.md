---
title: "Agent WebSocket Relay with E2E Encryption"
type: feat
status: active
date: 2026-03-05
deepened: 2026-03-05
---

# Agent WebSocket Relay with E2E Encryption

## Enhancement Summary

**Deepened on:** 2026-03-05
**Sections enhanced:** 12
**Research agents used:** architecture-strategist, security-sentinel, performance-oracle, kieran-typescript-reviewer, code-simplicity-reviewer, agent-native-reviewer, pattern-recognition-specialist, data-integrity-guardian, julik-frontend-races-reviewer, deployment-verification-agent, best-practices-researcher, learnings-researcher, framework-docs-researcher (coder/websocket, noble-curves)

### Key Improvements

1. **CRITICAL: Separate X25519 keypair required** — Non-extractable Ed25519 CryptoKey in IndexedDB blocks derivation to X25519. Must generate a separate X25519 keypair rather than deriving.
2. **Migration number fix** — Migration 007 collides with existing file. Must use 008.
3. **Nginx WebSocket config missing** — Must add `location /ws/agent` with `proxy_pass`, `Upgrade`, and `Connection` headers.
4. **Wire protocol simplified** — Remove `ping`/`error` types (WebSocket has native ping/pong). Only `request` and `response`.
5. **`relay_mode` DB column removed** — Derive relay status at runtime from WebSocket hub presence. No schema column needed.
6. **Forward secrecy via ephemeral keys** — Static ECDH gives no forward secrecy. Add per-session ephemeral X25519 exchange.
7. **PAKE-protected pairing** — Server sees pairing code in plaintext during relay. Use SRP or OPAQUE to prevent server MITM.
8. **`@target-uri` canonical format** — RFC 9421 signatures break through relay because agent reconstructs different URI. Define canonical format.
9. **Headless/CLI relay auth** — Relay endpoint needs Bearer token auth, not just session cookies, for agent-native access.
10. **XSS hard blocker** — Fix innerHTML XSS in dashboard.ts BEFORE Phase 2. E2E is meaningless if attacker can read decrypted payloads.

### Pre-requisites Discovered

- ~~Fix XSS vulnerability in `web/src/pages/dashboard.ts` (innerHTML injection)~~ DONE
- ~~Fix TOCTOU race in `web/src/lib/crypto.ts` `getOrCreateKeypair()` across tabs~~ DONE
- ~~Fix SSE connection leak in `web/src/pages/dashboard.ts` (no cleanup on re-render)~~ DONE

---

## Overview

Replace the current architecture where agents expose a public HTTP port (9443) with an outbound-only WebSocket connection from agent to server. The server becomes a blind relay — all browser-to-agent communication (pairing, storage, unpairing) is E2E encrypted so the server cannot read payloads. Users no longer need to expose ports, configure DNS, or manage TLS certificates for their agents.

## Problem Statement

Currently, the agent must be publicly reachable:
- Expose port 9443 with TLS (autocert / Let's Encrypt)
- Requires a public domain name (`AGENT_DOMAIN`)
- Users behind NAT/firewalls cannot use yourbro without port forwarding
- TLS certificate management adds operational complexity

This is the #1 barrier to adoption. Most users run ClawdBot on laptops or home machines without static IPs or the ability to expose ports.

## Proposed Solution

**Agent connects outbound to the server via WebSocket on boot.** The server maintains the connection and relays encrypted messages between browsers and agents. The server is cryptographically blind — it forwards opaque encrypted blobs.

### Architecture: Before vs After

```
BEFORE (Direct Mode):
  Browser ──RFC 9421 signed HTTP──► Agent:9443 (public port)
  Agent ──heartbeat POST──► Server

AFTER (Relay Mode):
  Agent ──WebSocket (outbound)──► Server
  Browser ──HTTP POST──► Server /api/relay/{agent_id} ──WS──► Agent
  Agent ──WS──► Server ──HTTP response──► Browser
  (All payloads E2E encrypted, server is blind relay)
```

## Technical Approach

### Phase 0: Pre-requisites

Before starting relay work, fix these existing issues discovered during research:

#### 0.1 XSS in Dashboard (HARD BLOCKER for Phase 2)

**File: `web/src/pages/dashboard.ts`**

The dashboard uses `innerHTML` with user-controlled data. This is a hard blocker for E2E encryption — if an attacker can inject scripts, they can read decrypted payloads and steal keypairs from IndexedDB.

- Sanitize all dynamic content or switch to `textContent` / DOM APIs
- Referenced in `SECURITY_TO_FIX_BEFORE_PUBLIC.md`

#### 0.2 Keypair Generation Race Condition

**File: `web/src/lib/crypto.ts`**

`getOrCreateKeypair()` has a TOCTOU race across browser tabs. Two tabs can both read "no keypair exists" and generate different keypairs. The second write wins, orphaning signatures made with the first.

**Fix:** Use IndexedDB transactions or a `BroadcastChannel` lock to serialize keypair creation.

#### 0.3 SSE Connection Leak

**File: `web/src/pages/dashboard.ts`**

Dashboard re-renders don't close previous SSE connections. Each re-render opens a new `EventSource` without cleaning up the old one.

**Fix:** Store `EventSource` reference and call `.close()` before creating a new one.

---

### Phase 1: WebSocket Tunnel (no E2E yet)

Establish the WebSocket infrastructure. Agent connects to server, server can relay messages. Pairing and storage work through the relay with existing RFC 9421 signatures (server can see data but can't forge signatures — same trust as HTTPS proxy).

#### 1.1 Agent WebSocket Client

**File: `agent/internal/relay/client.go` (new)**

- On boot, agent dials `wss://{YB_SERVER_URL}/ws/agent` with `Authorization: Bearer {YB_API_TOKEN}`
- Reconnection: exponential backoff (1s → 60s max, 10% jitter), retry indefinitely
- Use native WebSocket ping/pong (no application-level ping)
- Connection IS the heartbeat — server marks agent online when WS is open, offline on close

**Library: `github.com/coder/websocket`**

```go
import "github.com/coder/websocket"

// Dial with context for cancellation
ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
defer cancel()
conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
    HTTPHeader: http.Header{"Authorization": {"Bearer " + token}},
})
// Set read limit for max message size
conn.SetReadLimit(2 * 1024 * 1024) // 2MB
```

> **Research insight (coder/websocket docs):** Use `conn.Ping()` for keepalive rather than application-level ping messages. The library handles pong responses automatically. Use `wsjson.Read`/`wsjson.Write` for JSON message framing.

**File: `agent/cmd/server/main.go` (modify)**

- Auto-detect relay mode: if no `AGENT_PORT` and no `AGENT_DOMAIN` set → relay mode. No explicit `YB_RELAY_MODE` flag needed.
- Skip HTTP server startup entirely in relay mode
- Start WebSocket relay client instead
- Pairing code still generated and printed to stdout
- Route incoming relay messages to existing handlers

> **Research insight (simplicity reviewer):** Remove explicit `YB_RELAY_MODE` env var. Auto-detect from absence of `AGENT_PORT`/`AGENT_DOMAIN`. Fewer config knobs = fewer misconfiguration bugs.

#### 1.2 Server WebSocket Hub

**File: `api/internal/relay/hub.go` (new)**

```go
type Hub struct {
    mu      sync.RWMutex
    agents  map[int64]*AgentConn  // agentID → WebSocket conn
}

type AgentConn struct {
    ws       *websocket.Conn
    userID   int64
    agentID  int64
    pending  map[string]chan []byte  // requestID → response channel
}
```

- Accepts agent WebSocket connections at `GET /ws/agent`
- Authenticates via Bearer token (same as heartbeat)
- Maps `agentID → WebSocket connection`
- On connect: marks agent online, notifies SSE broker
- On disconnect: marks agent offline, notifies SSE broker, **drains all pending request channels with 503 error**
- Replaces heartbeat entirely for relay-mode agents

> **Research insight (architecture-strategist):** On disconnect, iterate `pending` map and close all channels with an error response. Otherwise HTTP handlers waiting on relay responses will hang until the 30s timeout.

> **Research insight (performance-oracle):** Add per-agent concurrency limiter (e.g., `semaphore.NewWeighted(20)`) to prevent one agent from monopolizing server resources with too many in-flight requests.

#### 1.3 Server Relay Endpoint

**File: `api/internal/handlers/relay.go` (new)**

`POST /api/relay/{agent_id}` — browser sends a relay request.

**Auth:** JWT session cookie OR `Authorization: Bearer` token. Bearer token auth enables headless/CLI/agent-native access (not just browser sessions).

```json
{
  "id": "uuid-v4",
  "method": "GET",
  "path": "/api/storage/my-page/title",
  "headers": {
    "Signature-Input": "...",
    "Signature": "...",
    "Content-Digest": "..."
  },
  "body": "<base64 or null>"
}
```

Server flow:
1. Authenticate browser (JWT session cookie or Bearer token)
2. Verify browser owns this agent (`agents.user_id = session.user_id`)
3. Forward message to agent via WebSocket
4. Hold HTTP connection open (with **5s timeout** — not 30s)
5. Agent processes request, sends response back via WebSocket
6. Server returns agent's response to browser

> **Research insight (performance-oracle):** Reduce relay timeout from 30s to 5s. Agent handlers are local SQLite reads/writes that complete in <10ms. A 30s timeout just masks dead connections. Use 5s for relay, keep 30s only for the WebSocket connection itself.

Agent response format:
```json
{
  "id": "uuid-v4",
  "status": 200,
  "headers": {"Content-Type": "application/json"},
  "body": "<base64 or null>"
}
```

#### 1.4 Wire Protocol

All WebSocket messages are JSON text frames:

```json
{
  "type": "request" | "response",
  "id": "uuid-v4",
  "payload": { ... }
}
```

- `request`: server → agent (relayed from browser)
- `response`: agent → server (relayed to browser)
- Max message size: 2MB (covers 1MB storage values + overhead)
- Request timeout: 5s (server closes pending request with 504)

> **Research insight (simplicity reviewer):** Removed `ping` and `error` message types. WebSocket has native ping/pong frames — use those. Errors are communicated via response messages with non-200 status codes. Two types instead of four.

> **Research insight (best-practices):** Add a `"v": 1` field to the wire protocol envelope for future versioning. Allows non-breaking protocol evolution.

#### 1.5 Agent Message Router

**File: `agent/internal/relay/router.go` (new)**

Receives WebSocket messages and routes to existing handlers by converting relay messages to `http.Request`/`http.ResponseWriter` compatible interfaces:

```go
func (r *Router) HandleMessage(msg Message) Response {
    // Build http.Request from msg fields
    req := buildHTTPRequest(msg)
    // Create response recorder
    rec := httptest.NewRecorder()
    // Route through existing chi router (auth middleware + handlers)
    r.mux.ServeHTTP(rec, req)
    // Return response
    return Response{ID: msg.ID, Status: rec.Code, ...}
}
```

This means **zero changes to existing handlers** — `StorageHandler`, `PairHandler`, and `VerifyUserSignature` middleware all work as-is.

> **Research insight (architecture-strategist):** When building `http.Request` from relay message, use a canonical `@target-uri` format: always set `req.URL` to `https://relay.internal{path}` and `req.Host = "relay.internal"`. This ensures RFC 9421 signature verification succeeds regardless of actual server URL. Both SDK and agent must agree on this canonical host for relay-mode signatures.

#### 1.6 SDK Changes

**File: `sdk/src/index.ts` (modify)**

`ClawdStorage` gets a new transport mode:

```typescript
class ClawdStorage {
  private mode: 'direct' | 'relay';
  private agentEndpoint: string;  // direct mode: agent URL, relay mode: unused
  private agentId: string;        // relay mode: agent DB id

  async get(key: string): Promise<string | null> {
    if (this.mode === 'relay') {
      return this.relayRequest('GET', `/api/storage/${this.slug}/${key}`);
    }
    return this.directRequest('GET', `/api/storage/${this.slug}/${key}`);
  }

  private async relayRequest(method: string, path: string): Promise<any> {
    const signed = await this.signRequest(method, path, body);
    const res = await fetch(`/api/relay/${this.agentId}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        id: crypto.randomUUID(),
        method,
        path,
        headers: signed.headers,
        body: signed.body,
      }),
    });
    return res.json();
  }
}
```

> **Research insight (agent-native reviewer):** Expose relay endpoint via Bearer token auth (not just cookies) so that other agents, CLI tools, and headless automation can access relay-mode agents. The SDK `signedFetch` should support `Authorization: Bearer` header injection.

> **Research insight (typescript reviewer):** Deduplicate crypto code between `sdk/src/index.ts` and `web/src/lib/crypto.ts`. Extract shared signing/encryption logic into a shared module or at least align the implementations.

#### 1.7 Page Rendering Changes

**File: `api/internal/handlers/pages.go` (modify)**

- Page meta tags: add `<meta name="clawd-relay-mode" content="true">` and `<meta name="clawd-agent-id" content="{agentID}">` when agent is in relay mode
- CSP `connect-src`: change from agent endpoint to `'self'` (relay goes through same origin)
- SDK detects relay mode from meta tags

#### 1.8 Database Migration

**File: `migrations/008_agent_relay_mode.sql` (new)**

> **Research insight (data-integrity-guardian):** Migration 007 already exists. Use 008.

```sql
-- agent_endpoint becomes nullable for relay-mode agents
ALTER TABLE agents ALTER COLUMN endpoint DROP NOT NULL;
```

> **Research insight (simplicity reviewer + data-integrity-guardian):** Removed `relay_mode BOOLEAN` column. Derive relay status at runtime: if agent has an active WebSocket connection in the Hub, it's relay-mode. If it has a non-null endpoint, it's direct-mode. No schema change needed beyond making endpoint nullable.

> **Research insight (data-integrity-guardian):** The existing `ON CONFLICT (user_id, endpoint)` unique constraint breaks with NULL endpoints (NULL ≠ NULL in SQL). Either add a partial unique index `WHERE endpoint IS NOT NULL`, or change the upsert logic. Also, `Agent.Endpoint` in Go must become `*string` (pointer) for nullable representation.

#### 1.9 Dashboard Pairing Flow Changes

**File: `web/src/pages/dashboard.ts` (modify)**

Current pairing asks for "Agent endpoint URL". In relay mode:
- Agent connects via WebSocket → appears in dashboard as "online (relay)"
- User clicks "Pair" next to an online relay-mode agent
- Enters pairing code only (no endpoint URL needed)
- Browser sends pairing request through relay endpoint
- Agent validates code, stores public key, responds through relay

New pairing UI for relay agents:
1. Agent boots → connects WS → shows up as "unpaired" in agent list
2. User sees agent name + pairing code hint ("check agent logs")
3. User enters pairing code
4. Browser POSTs to `/api/relay/{agent_id}` with pairing payload
5. Success → agent is paired

#### 1.10 Nginx WebSocket Configuration

**File: `deploy/nginx.conf` (modify)**

> **Research insight (deployment-verification-agent):** Current nginx config has NO WebSocket support. Must add:

```nginx
location /ws/agent {
    proxy_pass http://api:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400s;  # 24h — keep WS alive
    proxy_send_timeout 86400s;
}
```

Without this, nginx will close WebSocket connections as regular HTTP.

#### 1.11 SKILL.md Update

**File: `skill/SKILL.md` (modify)**

> **Research insight (agent-native reviewer):** Update setup instructions for relay mode. The simplified config (just `YB_API_TOKEN` + `YB_SERVER_URL`) should be the default/recommended path. Direct mode becomes the "advanced" option for users who want it.

---

### Phase 2: E2E Encryption

Add X25519 key exchange and AES-256-GCM encryption so the server becomes a true blind relay.

**BLOCKER:** XSS in dashboard.ts must be fixed first (Phase 0.1). E2E encryption is meaningless if an attacker can inject scripts that read decrypted payloads.

#### 2.1 Key Derivation Strategy

> **CRITICAL CHANGE from original plan (typescript reviewer + security-sentinel):** Cannot derive X25519 from existing Ed25519 keys in the browser. The Ed25519 keypair in IndexedDB uses `extractable: false` (WebCrypto), so the raw private key bytes are inaccessible for conversion.

**Revised approach: Generate separate X25519 keypair.**

- **Browser**: Generate a new X25519 keypair via WebCrypto (`crypto.subtle.generateKey("X25519", false, ["deriveBits"])`). Store in IndexedDB alongside Ed25519 keypair. Exchange X25519 public key during pairing.
- **Agent (Go)**: Generate X25519 keypair via `crypto/ecdh`. Store in `agent_identity` table. Exchange during pairing.

This means **pairing must exchange both Ed25519 (for signatures) and X25519 (for encryption) public keys**.

> **Research insight (security-sentinel):** This is actually better than derivation — it provides key separation (signing key ≠ encryption key), which is a cryptographic best practice.

#### 2.2 Encryption Scheme

1. **ECDH**: Browser's X25519 private + Agent's X25519 public → shared secret (32 bytes)
2. **HKDF**: `HKDF-SHA256(shared_secret, salt=random(32), info="yourbro-e2e-v1")` → AES-256 key
3. **AES-256-GCM**: Encrypt payloads with 12-byte random IV, prepended to ciphertext

> **Research insight (security-sentinel):** Changed from zero salt to random salt in HKDF. Zero salt provides no additional security. Use a per-session random salt exchanged in the clear during session setup.

> **Research insight (security-sentinel):** **Forward secrecy concern:** Static ECDH (same keys every session) means compromising one private key reveals all past messages. Consider adding ephemeral per-session X25519 keys:
> 1. On each WebSocket connection, generate ephemeral X25519 keypair
> 2. Exchange ephemeral public keys (signed with Ed25519 for authentication)
> 3. ECDH with ephemeral keys → session key
> 4. Even if long-term keys are later compromised, past sessions remain secure
>
> This follows the **Noise Protocol Framework KK pattern** (mutual key knowledge with ephemeral exchange). Consider using a Noise implementation (`noise-protocol` npm / `flynn/noise` Go) instead of hand-rolling.

**Browser (WebCrypto)**:
```javascript
const sharedSecret = await crypto.subtle.deriveBits(
  { name: "X25519", public: agentX25519Pub }, browserX25519Priv, 256
);
const hkdfKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
const aesKey = await crypto.subtle.deriveKey(
  { name: "HKDF", hash: "SHA-256", salt: sessionSalt, info: enc.encode("yourbro-e2e-v1") },
  hkdfKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
);
```

**Agent (Go)**:
```go
sharedSecret, _ := agentX25519Priv.ECDH(browserX25519Pub)
hkdfReader := hkdf.New(sha256.New, sharedSecret, sessionSalt, []byte("yourbro-e2e-v1"))
aesKey := make([]byte, 32)
io.ReadFull(hkdfReader, aesKey)
```

#### 2.3 Encrypted Relay Message Format

```json
{
  "type": "request",
  "id": "uuid-v4",
  "payload": "<base64 of IV(12) + AES-GCM ciphertext>"
}
```

Plaintext inside the encrypted envelope is the same JSON as Phase 1 (`method`, `path`, `headers`, `body`). The server only sees opaque `payload`.

> **Research insight (simplicity reviewer):** Removed `key_id` field. The agent knows which browser it's talking to from the relay context (agent has one user). If multi-user agents are added later, `key_id` can be introduced then.

> **Research insight (performance-oracle):** For Phase 2, consider switching to binary WebSocket frames instead of JSON+base64. Binary framing avoids the ~33% base64 overhead on encrypted payloads. Use a simple length-prefixed binary format: `[4-byte type][4-byte id-length][id][payload]`.

#### 2.4 MITM Protection During Pairing

> **Research insight (security-sentinel):** The original plan's MITM protection is insufficient. The server relays the pairing code in plaintext — a malicious server can read the code and substitute public keys.

**Revised approach: PAKE-protected key exchange.**

Use SRP (Secure Remote Password) or OPAQUE with the pairing code as the password:

1. Browser and agent run PAKE protocol through relay using pairing code as shared secret
2. PAKE establishes an encrypted channel that the relay server cannot read, even though it sees the pairing code
3. Exchange Ed25519 + X25519 public keys through the PAKE channel
4. Complete pairing

**Simpler alternative (acceptable for v1):** Accept that the server is trusted during pairing only. After pairing, all communication is E2E encrypted with keys the server doesn't have. Document this trust assumption clearly. Add PAKE in a follow-up.

> **Research insight (best-practices):** For the simpler v1 approach, add an out-of-band key fingerprint verification step: after pairing, show the X25519 public key fingerprint (first 8 chars of base64) on both the agent terminal and the browser dashboard. User visually confirms they match.

#### 2.5 Agent X25519 Key Storage

The agent needs its own Ed25519 keypair AND X25519 keypair:

**File: `agent/internal/storage/sqlite.go` (modify)**

```sql
CREATE TABLE IF NOT EXISTS agent_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ed25519_private_key BLOB NOT NULL,
  ed25519_public_key BLOB NOT NULL,
  x25519_private_key BLOB NOT NULL,
  x25519_public_key BLOB NOT NULL
);
```

Generated on first boot. Public keys are sent to the server during WebSocket registration so browsers can derive encryption keys.

#### 2.6 Browser Key Management

**File: `web/src/lib/crypto.ts` (modify)**

- Generate separate X25519 keypair (`extractable: false`) and store in IndexedDB
- Store agent X25519 public keys in IndexedDB: key `agent-x25519-{agentId}`
- Derive AES key lazily on first relay request to each agent, cache in memory
- **Fix TOCTOU race** in `getOrCreateKeypair()` before adding X25519 key generation (Phase 0.2)

#### 2.7 SDK Encryption Integration

**File: `sdk/src/index.ts` (modify)**

```typescript
private async relayRequest(method: string, path: string, body?: string) {
  const plaintext = JSON.stringify({ method, path, headers: signedHeaders, body });
  const encrypted = await this.encrypt(plaintext);
  const res = await fetch(`/api/relay/${this.agentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encrypted,
  });
  const encryptedResponse = new Uint8Array(await res.arrayBuffer());
  return JSON.parse(await this.decrypt(encryptedResponse));
}
```

---

### Phase 3: Migration and Cleanup

#### 3.1 Dual-Mode Support

During migration, both modes coexist:

- Agent config: auto-detected from presence of `AGENT_PORT`/`AGENT_DOMAIN` env vars
- Server: relay-mode agents use WebSocket, direct-mode agents keep heartbeat
- SDK: checks `clawd-relay-mode` meta tag to choose transport
- Dashboard: shows connection mode per agent

#### 3.2 Database Migration for Existing Agents

- Existing agents keep their endpoint URL and direct mode
- Users can "upgrade" by removing `AGENT_PORT`/`AGENT_DOMAIN` from config and restarting
- **Re-pairing IS needed** (X25519 keys must be exchanged — they're not derived from Ed25519 anymore)

#### 3.3 Deprecate Direct Mode (Future)

After relay mode is stable:
- Remove direct-mode code paths from agent
- Remove `AGENT_DOMAIN`, `AGENT_PORT`, `YB_AGENT_ENDPOINT` env vars
- Remove autocert/TLS setup from agent
- Simplify agent to just: WebSocket client + SQLite storage + message handlers

#### 3.4 Agent Configuration Simplification

Current agent env vars (direct mode):
```
AGENT_DOMAIN=my-agent.example.com
AGENT_PORT=9443
YB_API_TOKEN=xxx
YB_SERVER_URL=https://yourbro.ai
YB_AGENT_ENDPOINT=https://my-agent.example.com:9443
```

Relay mode:
```
YB_API_TOKEN=xxx
YB_SERVER_URL=wss://yourbro.ai
```

Two env vars instead of five. No domain, no port, no TLS.

---

## Acceptance Criteria

### Functional Requirements

- [x] Agent connects to server via outbound WebSocket (no exposed port)
- [x] Pairing works through relay (user enters pairing code only, no endpoint URL)
- [x] All storage operations (get/set/list/delete) work through relay
- [x] Agent unpairing works through relay
- [x] E2E encryption: server cannot read relay payloads (Phase 2)
- [x] SDK pages work with relay-mode agents
- [x] Dashboard shows relay-mode agent status (online/offline via WS state)
- [x] Agent reconnects automatically on WebSocket disconnect (exponential backoff)
- [x] Nginx configured for WebSocket upgrade on `/ws/agent`
- [x] Relay endpoint accepts Bearer token auth (not just cookies)
- [x] SKILL.md updated with relay-mode setup instructions

### Non-Functional Requirements

- [ ] Relay adds < 50ms latency vs direct mode (same region)
- [ ] Server handles 1000+ concurrent agent WebSocket connections
- [ ] Backward compatible: direct-mode agents continue to work
- [ ] Pending requests drained with 503 on agent disconnect

### Security Requirements

- [x] XSS in dashboard.ts fixed before E2E ships (Phase 0.1)
- [x] Server cannot read E2E encrypted payloads
- [x] Server cannot forge RFC 9421 signatures
- [x] X25519 keypairs generated separately (not derived from Ed25519)
- [x] Agent authenticates WebSocket connection via API token
- [x] Replay protection: nonce + timestamp validation on agent side
- [x] Key fingerprint verification available after pairing (visual confirmation)

## Dependencies & Risks

### Dependencies

- `github.com/coder/websocket` — Go WebSocket library (actively maintained successor to nhooyr.io/websocket)
- `golang.org/x/crypto/hkdf` — HKDF key derivation in Go
- `@noble/curves` — X25519 polyfill for browsers without WebCrypto X25519
- WebCrypto X25519 support (Chrome 133+, Firefox, Safari — good coverage in 2026)

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebSocket scaling (single server instance) | High | Phase 1 targets single instance. Redis pub/sub for multi-instance is a follow-up. |
| WebCrypto X25519 browser support gaps | Low | Good coverage in 2026. Polyfill via `@noble/curves` for older browsers. |
| **Existing XSS vulnerability** | **Critical** | **Fix innerHTML XSS in dashboard BEFORE shipping E2E.** |
| Server MITM during pairing (sees pairing code) | Medium | v1: accept trusted server during pairing, add fingerprint verification. v2: PAKE protocol. |
| `ON CONFLICT` with NULL endpoints | Medium | Add partial unique index or change upsert logic. |
| Re-pairing needed for existing agents | Medium | X25519 keys not derivable from non-extractable Ed25519. Clear migration docs needed. |
| `@target-uri` mismatch in RFC 9421 signatures | High | Use canonical `relay.internal` host in both SDK and agent for relay-mode signatures. |

## Implementation Order

1. **Phase 0.1–0.3**: Pre-requisites (XSS fix, keypair race, SSE leak)
2. **Phase 1.1–1.5**: WebSocket tunnel infrastructure (agent client, server hub, relay endpoint, wire protocol, message router)
3. **Phase 1.6–1.7**: SDK relay transport + page rendering changes
4. **Phase 1.8–1.10**: Database migration + dashboard pairing UX + nginx config
5. **Phase 1.11**: SKILL.md update
6. **Phase 2.1–2.3**: E2E encryption (separate X25519 keypairs, AES-GCM, encrypted envelope)
7. **Phase 2.4–2.7**: MITM protection (fingerprint verification), agent identity, browser key management, SDK encryption
8. **Phase 3**: Migration path, dual-mode, eventual direct-mode deprecation

## Files Changed

### New Files
- `agent/internal/relay/client.go` — WebSocket client with reconnection
- `agent/internal/relay/router.go` — WS message → HTTP handler adapter
- `api/internal/relay/hub.go` — WebSocket connection hub
- `api/internal/handlers/relay.go` — HTTP relay endpoint
- `migrations/008_agent_relay_mode.sql` — schema changes (make endpoint nullable)

### Modified Files
- `agent/cmd/server/main.go` — conditional relay vs direct mode startup (auto-detect)
- `agent/internal/storage/sqlite.go` — agent identity table (Ed25519 + X25519)
- `api/cmd/server/main.go` — register relay routes
- `api/internal/handlers/agents.go` — relay-mode agent registration
- `api/internal/handlers/pages.go` — relay meta tags, CSP changes
- `api/internal/handlers/sse.go` — WebSocket state as heartbeat source
- `api/internal/models/agent.go` — `Endpoint` becomes `*string`
- `sdk/src/index.ts` — relay transport + E2E encryption
- `web/src/pages/dashboard.ts` — relay-mode pairing UX + XSS fix
- `web/src/lib/crypto.ts` — X25519 keypair generation, TOCTOU fix
- `skill/SKILL.md` — update setup instructions (simplified config)
- `deploy/nginx.conf` — WebSocket upgrade location block
- `deploy/docker-compose.prod.yml` — remove agent port exposure

## References

### Internal
- `api/internal/handlers/sse.go` — existing SSE pattern for server-push
- `agent/internal/middleware/auth.go` — RFC 9421 signature verification
- `web/src/lib/crypto.ts` — existing Ed25519 keypair management
- `sdk/src/index.ts` — current direct-mode SDK
- `docs/solutions/integration-issues/sse-real-time-dashboard-agent-status.md` — SSE lessons (nginx buffering, state tracking)
- `docs/solutions/security-issues/incomplete-agent-key-revocation-on-removal.md` — key revocation flow
- `SECURITY_TO_FIX_BEFORE_PUBLIC.md` — XSS fix must precede E2E shipping

### External
- [coder/websocket](https://github.com/coder/websocket) — Go WebSocket library
- [WebCrypto X25519](https://wicg.github.io/webcrypto-secure-curves/) — W3C spec
- [@noble/curves](https://github.com/paulmillr/noble-curves) — audited JS crypto library
- [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421) — HTTP Message Signatures
- [Noise Protocol Framework](https://noiseprotocol.org/) — consider KK pattern for E2E with forward secrecy

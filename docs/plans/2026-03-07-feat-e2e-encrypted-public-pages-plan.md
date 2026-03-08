---
title: "E2E Encrypted Public Pages"
type: feat
status: active
date: 2026-03-07
---

# E2E Encrypted Public Pages

## Overview

Unify public and private page viewing into a single E2E encrypted flow. The server becomes zero-knowledge for all page traffic. The shell always does the same thing — the agent decides access based on `key_id`.

## Problem

Two separate flows with different trust models:

| Path | Auth | Encrypted | Shell logic |
|------|------|-----------|-------------|
| Private | cookie + `/api/content-token` + `/api/page-agents` | Yes (paired keys) | Complex branching |
| Public | none | **No** (plaintext relay) | Separate code path |

The server can read public page content. The shell has 300+ lines of branching for two paths that end up doing the same thing: fetch a page bundle and render it.

## Solution: unified flow

One flow for all pages. Agent controls access.

```
1. GET /api/public-page/{username}/{slug}
   -> API returns { agent_uuid, x25519_public } from DB (no relay, no content)

2. Shell generates/loads X25519 key pair from IndexedDB
   Shell derives AES key from ECDH(viewer_priv, agent_pub)

3. POST /api/public-page/{agent_uuid}/{slug} { encrypted blob }
   -> API forwards opaque blob to agent by UUID (blind relay, no auth)
   -> Agent decrypts, decides access:
      - key_id is a paired user -> serve ANY page (public or private)
      - key_id is anonymous    -> serve only public:true pages
   -> Agent encrypts response
   -> Viewer decrypts, renders
```

**Why this works:** "Decryption success = authentication." If the agent can decrypt and the `key_id` matches a paired user in `authorized_keys`, that's proof of identity — no session cookie or content-token needed. Anonymous keys just get public pages.

**What changes for paired users:** Nothing in terms of access. They already have keys in IndexedDB from pairing. The discovery GET returns the same agent pubkey they already have cached. The POST goes to the same agent. The only difference is the endpoint path — `/api/public-page/{agent_uuid}/{slug}` instead of `/api/relay/{agentId}`.

**What this eliminates from shell.html:**
- `yb_logged_in` check
- `/api/content-token` call
- `/api/page-agents/{username}` call
- Separate private page E2E code path
- The 150+ lines of branching between public/private flows

### Agent access control

**`agent/internal/handlers/pages.go`** — modify page handlers to check access:

```go
func (h *PagesHandler) Get(w http.ResponseWriter, r *http.Request) {
    slug := chi.URLParam(r, "slug")
    keyID := r.Header.Get("X-Yourbro-Key-ID")

    // Check if this is a paired user (key_id in authorized_keys)
    isPaired := h.isPairedUser(keyID)

    meta := readPageMeta(h.PagesDir, slug)

    // Paired users can access any page. Anonymous users only public pages.
    if !isPaired && !meta.Public {
        writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
        return
    }

    bundle, status, err := h.buildBundle(slug)
    // ... serve bundle ...
}
```

The relay router already injects `X-Yourbro-Key-ID` after decryption (`router.go:71-76`), so this header is available to the handler.

## Implementation

### 1. DB: add x25519_public_key to agents table

**`migrations/013_agent_x25519_pubkey.sql` (new)**

```sql
ALTER TABLE agents ADD COLUMN IF NOT EXISTS x25519_public_key BYTEA;
```

**`api/internal/storage/postgres.go`** — add `UpdateAgentX25519PubKey(ctx, dbId, pubKey)`. Include `x25519_public_key` in `ListAgents` and `GetAgentByUUID` queries.

### 2. Agent: send X25519 pubkey during WS connect

**`agent/internal/relay/client.go`** — add `x25519_pub` query param:

```
wss://api.yourbro.ai/ws/agent?name=MyAgent&uuid=abc-123&x25519_pub=<base64>
```

**`api/internal/relay/hub.go`** — in `HandleAgentWS`, read `x25519_pub` and call `DB.UpdateAgentX25519PubKey()`.

### 3. API: GET discovery + POST encrypted relay

**`api/cmd/server/main.go`**

```go
// GET: discovery — returns agent UUID + X25519 pubkey (no content, no relay, no auth)
r.Get("/api/public-page/{username}/{slug}", func(w http.ResponseWriter, r *http.Request) {
    username := chi.URLParam(r, "username")
    slug := chi.URLParam(r, "slug")
    if !validSlugRe.MatchString(slug) { writeNotFound(w); return }

    user, err := db.GetUserByUsername(r.Context(), username)
    if err != nil { writeNotFound(w); return }

    agents, _ := db.ListAgents(r.Context(), user.ID)
    for _, agent := range agents {
        if !relayHub.IsOnline(agent.DBId) { continue }
        if agent.X25519PubKey == nil { continue }
        w.Header().Set("Content-Type", "application/json")
        w.Header().Set("Cache-Control", "public, s-maxage=300")
        json.NewEncoder(w).Encode(map[string]interface{}{
            "agent_uuid":    agent.ID,
            "x25519_public": base64.StdEncoding.EncodeToString(agent.X25519PubKey),
        })
        return
    }
    writeNotFound(w)
})

// POST: encrypted page fetch — blind relay by agent UUID, no auth
r.Post("/api/public-page/{agent_uuid}/{slug}", func(w http.ResponseWriter, r *http.Request) {
    agentUUID := chi.URLParam(r, "agent_uuid")
    slug := chi.URLParam(r, "slug")
    if !validSlugRe.MatchString(slug) { writeNotFound(w); return }

    var body struct {
        ID        string `json:"id"`
        Encrypted bool   `json:"encrypted"`
        KeyID     string `json:"key_id"`
        Payload   string `json:"payload"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeNotFound(w); return }
    if !body.Encrypted || body.KeyID == "" || body.Payload == "" { writeNotFound(w); return }

    agent, err := db.GetAgentByUUID(r.Context(), agentUUID)
    if err != nil || !relayHub.IsOnline(agent.DBId) { writeNotFound(w); return }

    ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
    defer cancel()

    reqID, _ := auth.GenerateRandomHex(16)
    resp, err := relayHub.SendRequest(ctx, agent.ID, models.RelayRequest{
        ID: reqID, Encrypted: true, KeyID: body.KeyID, Payload: body.Payload,
    })
    if err != nil { writeNotFound(w); return }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(resp)

    viewRecorder.Record(analytics.PageView{
        UserID: agent.UserID, Slug: slug,
        IP: r.RemoteAddr, Referrer: r.Header.Get("X-Referrer"), UserAgent: r.UserAgent(),
    })
})
```

### 4. Agent: accept anonymous keys + access control

**`agent/internal/relay/router.go`** — modify `getUserCipher()`:

```go
// After paired user lookup fails, accept anonymous key directly
curve := ecdh.X25519()
anonPub, err := curve.NewPublicKey(keyBytes)
if err != nil {
    return nil, fmt.Errorf("invalid X25519 public key")
}
return r.CipherCache.Get(anonPub)
```

**`agent/internal/handlers/pages.go`** — merge `Get` and `GetPublic` into a single handler with access check:

```go
func (h *PagesHandler) Get(w http.ResponseWriter, r *http.Request) {
    slug := chi.URLParam(r, "slug")
    keyID := r.Header.Get("X-Yourbro-Key-ID")
    isPaired := h.isPairedUser(keyID)
    meta := readPageMeta(h.PagesDir, slug)

    if !isPaired && !meta.Public {
        writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
        return
    }

    bundle, status, err := h.buildBundle(slug)
    // ... serve ...
}
```

**`agent/internal/e2e/e2e.go`** — add LRU eviction to `CipherCache` (max 10k entries).

### 5. Shell: single unified flow

**`web/public/p/shell.html`** — replace all page-fetch logic with one flow:

```javascript
// 1. Generate/load X25519 key pair from IndexedDB (always, for all visitors)

// 2. GET /api/public-page/{username}/{slug} -> { agent_uuid, x25519_public }
//    Cached in localStorage for 24h

// 3. Derive AES key: ECDH(viewer_priv, agent_pub) + HKDF

// 4. Encrypt inner request: { method: "GET", path: "/api/page/{slug}" }
//    POST /api/public-page/{agent_uuid}/{slug}

// 5. Decrypt response -> renderPage()

// 6. On failure -> "page not available" (no more branching)
```

**No more decision tree.** One path:
```
GET discovery -> derive keys -> POST encrypted -> decrypt -> render
  |-- 404 from discovery -> "agent offline or page not found"
  |-- decrypt fail       -> clear cache, retry once, then error
```

**Storage bridge** still uses `/api/relay/{agentId}` with session auth — that's a separate concern (not page viewing).

## Files Changed

| File | Action |
|------|--------|
| `migrations/013_agent_x25519_pubkey.sql` | **New** — add `x25519_public_key` column |
| `api/internal/storage/postgres.go` | Add `UpdateAgentX25519PubKey`, include pubkey in agent queries |
| `api/internal/models/models.go` | Add `X25519PubKey []byte` to `Agent` struct |
| `api/internal/relay/hub.go` | Read `x25519_pub` from WS connect, store in DB |
| `api/cmd/server/main.go` | Replace GET handler (discovery only), add POST (encrypted relay) |
| `agent/internal/relay/client.go` | Send X25519 pubkey as query param on WS connect |
| `agent/internal/relay/router.go` | Accept anonymous keys in `getUserCipher` |
| `agent/internal/e2e/e2e.go` | LRU eviction for `CipherCache` |
| `agent/internal/handlers/pages.go` | Merge Get/GetPublic, add `key_id`-based access control |
| `web/public/p/shell.html` | Replace 300+ lines of branching with single unified E2E flow |

## Acceptance Criteria

- [x] Agent sends X25519 pubkey during WS connect (Bearer token auth)
- [x] API stores it in `agents.x25519_public_key`
- [x] `GET /api/public-page/{username}/{slug}` returns `{ agent_uuid, x25519_public }` (discovery only)
- [x] `POST /api/public-page/{agent_uuid}/{slug}` relays encrypted blob to agent by UUID (no auth)
- [x] Agent checks `key_id`: paired user → any page, anonymous → public only
- [x] Server cannot read any page content (all traffic E2E encrypted)
- [x] Shell uses one unified flow for all pages (no public/private branching)
- [x] CipherCache has LRU eviction (10k max)
- [x] Storage bridge uses E2E encrypted relay (no cookies needed)

## Trade-offs

- **CDN caching lost for page content**: Encrypted responses are per-viewer. Discovery GET is CDN-cacheable. Agent-side bundle cache mitigates disk I/O.
- **Two requests instead of one**: GET (discovery) + POST (encrypted). Discovery cacheable in localStorage + CDN.
- **Storage bridge is still separate**: Page viewing is unified, but storage operations still use the authenticated relay endpoint. Could be unified later.

## References

- `agent/internal/e2e/e2e.go` — ECDH + HKDF + AES-256-GCM cipher
- `agent/internal/relay/router.go:71-76` — `X-Yourbro-Key-ID` header injection after decryption
- `agent/internal/relay/router.go:101-128` — `getUserCipher` (modify target)
- `api/internal/relay/hub.go:55-86` — `HandleAgentWS` (add x25519_pub handling)
- `api/cmd/server/main.go:248-316` — current plaintext public page handler
- `web/public/p/shell.html` — current 300+ line branching flow to replace
- `docs/solutions/refactoring/remove-ed25519-signing-rfc9421.md` — "decryption success = authentication"

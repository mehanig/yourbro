---
title: "feat: Add public page support"
type: feat
status: active
date: 2026-03-06
deepened: 2026-03-06
---

# feat: Add Public Page Support

## Enhancement Summary

**Deepened on:** 2026-03-06
**Review agents used:** Security Sentinel, Performance Oracle, Architecture Strategist, Code Simplicity Reviewer, Pattern Recognition Specialist, Frontend Races Reviewer, Agent-Native Reviewer, Repo Research Analyst, SpecFlow Analyzer

### Critical Findings

1. **Iframe sandbox is a security risk for public pages** — current `sandbox="allow-scripts allow-same-origin"` on `yourbro.ai` gives untrusted page content access to viewers' X25519 keys and session cookies. Must be mitigated.
2. **Service Worker activation race** — first-time visitors have no SW installed. Public fetch returns fast, but iframe loads before SW is ready → 404. Must await SW activation.
3. **Stale SW cache after privacy toggle** — SW cache has no eviction. Visitors who loaded a public page retain it after the page is made private. Must version or clear cache.
4. **Shell flow should branch on auth state, not try-public-first** — trying public first penalizes authenticated users with an extra network round-trip on every private page view.
5. **WebSocket 2MB limit vs 10MB bundle limit** — pages with images will silently fail. Must increase WS limit or add compression.
6. **CLAUDE.md must be updated** — current "NEVER plaintext relay" rule blocks implementation.

### Key Simplifications (from reviewers)

- Defer Phase 4 (dashboard toggle) — ship core feature first
- Merge `GetPublic` into existing `Get` handler with public flag check
- No new `public_pages.go` file — inline ~25-line handler in `main.go`
- Add `singleflight` request coalescing for concurrent viewers
- Add `Cache-Control` headers for Cloudflare edge caching

---

## Overview

Add the ability for users to mark pages as "public" so anyone with the link can view them — no yourbro account, no pairing, no encryption needed. Agent must be online to serve public pages (content is never stored on the server). This enables portfolio/showcase use cases.

## Problem Statement

Currently, every page view requires:
1. A yourbro account (Google OAuth)
2. Browser paired with the agent (X25519 key exchange)
3. E2E encryption for every relay request

This makes sharing impossible. If a user builds a page with ClawdBot and wants to show it to someone, that person needs to sign up, pair, and have crypto keys — a non-starter for portfolios, demos, or blog posts.

## Proposed Solution

Add a `"public": true` flag in `page.json`. When a page is public, the API server relays the request to the agent **without auth or encryption**, and the agent serves the page bundle in plaintext. The shell detects public pages and skips the E2E flow.

### Key Principles

- **Agent decides**: The agent checks `page.json` for `public: true` before serving. The API server is just a relay — it doesn't know or store page content.
- **Agent must be online**: No server-side caching of public pages. If the agent is offline, the page is unavailable.
- **Same URL pattern**: `/p/{username}/{slug}` works for both public and private pages.
- **Plaintext relay for public only**: Private pages remain fully E2E encrypted. No degradation.

## Technical Approach

### Architecture

```
Viewer → shell.html → GET /api/public-page/{user}/{slug} → API server
                                                              ↓
                                                    WebSocket relay (plaintext)
                                                              ↓
                                                    Agent checks page.json
                                                              ↓
                                                    public: true → serve bundle
                                                    public: false → 404
```

### Flow: Public Page View (Happy Path)

1. Viewer visits `yourbro.ai/p/{username}/{slug}`
2. `shell.html` loads, parses username + slug from URL
3. Shell registers Service Worker and **awaits activation** (critical for first-time visitors)
4. Shell checks for `yb_session` cookie presence (no network request — just `document.cookie` check)
5. **No cookie** → Shell makes unauthenticated request: `GET /api/public-page/{username}/{slug}`
6. API server looks up username → finds user's agent IDs → tries each online agent until one returns 200
7. Agent receives request, reads `page.json`, checks `"public": true`
8. Agent returns page bundle (same `pageBundle` JSON: slug, title, files)
9. API server returns response to shell with `Cache-Control: public, s-maxage=60`
10. Shell caches files in Service Worker, renders in iframe

### Research Insight: Shell Flow Ordering

Multiple reviewers flagged that "try public first" penalizes authenticated users. Every private page view would incur an extra network round-trip (the failing public fetch traverses the full WebSocket relay path — not just a fast 404).

**Better approach**: Branch on auth state at the start. Check `document.cookie` for `yb_session` — zero network requests needed:
- **Cookie present** → go straight to E2E flow (existing path)
- **No cookie** → try public endpoint. If 404, show "Sign in to view this page"

This eliminates the latency penalty for the majority use case (owners viewing their own pages).

### Flow: Private Page (Authenticated User)

1. Shell detects `yb_session` cookie → proceeds directly to E2E flow
2. Existing auth check, agent discovery, key derivation, encrypted relay
3. If auth/keys missing, shows appropriate error

### Flow: Mixed Pages

A user can have some public and some private pages. Each page's visibility is independent, controlled by its own `page.json`.

### Research Insight: Multi-Agent Resolution

The original plan picked "first online agent." This is non-deterministic — Agent A might have `portfolio` as public, Agent B doesn't. If B is picked first, visitor gets 404.

**Fix**: Try all online agents in sequence until one returns 200 for the requested slug. Cost is bounded (users rarely have >2-3 agents).

### Implementation Phases

#### Phase 1: Agent-side — `page.json` and public-aware page handler

**File: `agent/internal/handlers/pages.go`**

- Replace `readTitle()` with `readPageMeta()` that returns full metadata (title + public flag)
- Add `Public bool` field to `pageSummary` and `pageBundle` structs
- Modify `Get()` handler to include `public` field in response
- Add `GetPublic()` handler — calls `readPageMeta()`, returns 404 if not public, otherwise delegates to shared bundle-building logic
- Update `List()` to include `public` field

```go
// page.json example: {"title": "My Portfolio", "public": true}

type pageMeta struct {
    Title  string `json:"title"`
    Public bool   `json:"public"`
}

func readPageMeta(pagesDir, slug string) pageMeta {
    data, err := os.ReadFile(filepath.Join(pagesDir, slug, "page.json"))
    if err != nil {
        return pageMeta{Title: slug}
    }
    var meta pageMeta
    if json.Unmarshal(data, &meta) != nil || meta.Title == "" {
        meta.Title = slug
    }
    return meta
}
```

##### Research Insight: Avoid Handler Duplication

The simplicity reviewer noted that `GetPublic` duplicating all of `Get` (80+ lines of slug validation, path traversal, file walking) is wasteful. Instead, extract the bundle-building logic into a shared helper:

```go
func (h *PagesHandler) buildBundle(slug string) (*pageBundle, int, error) {
    // validation, path traversal check, file walking — shared logic
    // returns bundle, HTTP status, error
}

func (h *PagesHandler) Get(w http.ResponseWriter, r *http.Request) {
    slug := chi.URLParam(r, "slug")
    bundle, status, err := h.buildBundle(slug)
    // ... return bundle ...
}

func (h *PagesHandler) GetPublic(w http.ResponseWriter, r *http.Request) {
    slug := chi.URLParam(r, "slug")
    meta := readPageMeta(h.PagesDir, slug)
    if !meta.Public {
        writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
        return
    }
    bundle, status, err := h.buildBundle(slug)
    // ... return bundle ...
}
```

**File: `agent/cmd/server/main.go`**

- Add route: `r.Get("/api/public-page/{slug}", pagesHandler.GetPublic)`

#### Phase 2: API server — public relay endpoint

**File: `api/cmd/server/main.go`**

Add an inline handler **outside** the `/api` auth group (~25 lines, no new file needed):

```go
// Public page relay — no auth required, rate-limited.
// Agent decides whether to serve based on page.json "public" flag.
r.Get("/api/public-page/{username}/{slug}", func(w http.ResponseWriter, r *http.Request) {
    username := chi.URLParam(r, "username")
    slug := chi.URLParam(r, "slug")

    // Validate slug at API level too (defense in depth)
    if !regexp.MustCompile(`^[a-z0-9-]+$`).MatchString(slug) {
        writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid slug"})
        return
    }

    user, err := db.GetUserByUsername(r.Context(), username)
    if err != nil {
        // Uniform 404 — don't leak whether username exists
        writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
        return
    }

    agents, err := db.ListAgents(r.Context(), user.ID)
    if err != nil || len(agents) == 0 {
        writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
        return
    }

    // Try each online agent until one serves the page
    ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
    defer cancel()

    for _, agent := range agents {
        if !relayHub.IsOnline(agent.ID) {
            continue
        }
        req := models.RelayRequest{
            ID:     uuid.NewString(),
            Method: "GET",
            Path:   "/api/public-page/" + slug,
        }
        resp, err := relayHub.SendRequest(ctx, agent.ID, req)
        if err != nil {
            continue
        }
        if resp.Status == 200 && resp.Body != nil {
            w.Header().Set("Content-Type", "application/json")
            w.Header().Set("Cache-Control", "public, s-maxage=60")
            w.WriteHeader(200)
            w.Write([]byte(*resp.Body))
            return
        }
    }

    writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
})
```

##### Research Insight: Security — Uniform 404 Responses

The security reviewer flagged that returning 503 for "agent offline" vs 404 for "not public" creates an anonymous agent-status oracle. **Always return 404 for any failure** — don't leak whether the username exists, whether the agent is online, or whether the page exists but is private.

##### Research Insight: API-Side Slug Validation

The agent validates slugs with `^[a-z0-9-]+$`, but the API constructs the relay path without validation. Defense in depth requires validation at both layers to prevent path injection.

##### Research Insight: Singleflight Request Coalescing

Use `golang.org/x/sync/singleflight` to ensure only one relay request per `{agentID}:{slug}` is in flight at a time. All concurrent requests for the same public page wait for the single relay response. ~20 lines, massive impact on concurrent viewers.

```go
import "golang.org/x/sync/singleflight"

var publicPageGroup singleflight.Group

// In handler:
key := fmt.Sprintf("%d:%s", agent.ID, slug)
result, err, _ := publicPageGroup.Do(key, func() (interface{}, error) {
    return relayHub.SendRequest(ctx, agent.ID, req)
})
```

##### Research Insight: Cloudflare Edge Caching

Adding `Cache-Control: public, s-maxage=60` to the response enables Cloudflare to cache it at edge nodes worldwide. Global latency drops from 200-2000ms (relay round-trip) to <50ms for cached responses. The agent is completely shielded from traffic spikes. Zero infrastructure changes needed — Cloudflare already proxies `api.yourbro.ai`.

##### Research Insight: Rate Limiting (Phase 1, Not "Later")

This is the first surface exposed to the entire internet without authentication. Rate limiting must ship with the feature, not as a follow-up.

```go
// Per-IP token bucket: 30 req/min
r.With(httprate.LimitByIP(30, time.Minute)).
    Get("/api/public-page/{username}/{slug}", ...)
```

Use `go-chi/httprate` (already compatible with chi router).

#### Phase 3: Shell — branch on auth state

**File: `web/public/p/shell.html`**

```javascript
(async function() {
    var API = 'https://api.yourbro.ai';

    // Parse username and slug from /p/{username}/{slug}
    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length < 3 || parts[0] !== 'p') {
        document.body.innerHTML = '<div class="status-msg">Invalid page URL.</div>';
        return;
    }
    var username = decodeURIComponent(parts[1]);
    var slug = decodeURIComponent(parts[2]);
    document.title = slug + ' \u2014 yourbro';

    // Register Service Worker FIRST — must be ready before iframe creation
    var swReady = null;
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('/p/page-sw.js', { scope: '/p/' });
            swReady = navigator.serviceWorker.ready;
            // CRITICAL: Await activation for first-time visitors
            var reg = await swReady;
            // Ensure SW is active (not just installing)
            if (!reg.active) {
                await new Promise(function(resolve) {
                    reg.installing.addEventListener('statechange', function() {
                        if (reg.active) resolve();
                    });
                });
            }
        } catch(e) {
            console.warn('SW registration failed:', e);
        }
    }

    // Branch on auth state — check cookie presence (no network request)
    var hasSession = document.cookie.split(';').some(function(c) {
        return c.trim().startsWith('yb_session=');
    });

    var pageData = null;

    if (!hasSession) {
        // Unauthenticated visitor — try public endpoint
        try {
            var publicResp = await fetch(API + '/api/public-page/' +
                encodeURIComponent(username) + '/' + encodeURIComponent(slug));
            if (publicResp.ok) {
                pageData = await publicResp.json();
            }
        } catch(e) { /* network error — fall through */ }

        if (!pageData || !pageData.files || !pageData.files['index.html']) {
            document.body.innerHTML = '<div class="status-msg">' +
                'This page is not available.' +
                '<div class="subtitle">It may be private or the agent may be offline.</div>' +
                '<a href="/">Sign in</a></div>';
            return;
        }
    } else {
        // Authenticated user — existing E2E encrypted flow
        // ... (existing auth, agent discovery, key derivation, encrypted relay) ...
    }

    // Shared rendering path: SW caching + iframe
    // ... (cache in SW, create iframe, storage bridge) ...
})();
```

##### Research Insight: SW Activation Race (CRITICAL)

The frontend races reviewer identified that first-time visitors (incognito, new browser) have no Service Worker installed. The public fetch returns fast (one network hop vs 3-5 for E2E), so the shell tries to set `iframe.src` before the SW is controlling the page. The iframe fetches `/p/assets/{slug}/index.html` from the network, Cloudflare returns 404, and the visitor sees a blank page.

**Fix**: Await SW activation explicitly before proceeding. The current code accidentally works because the 3-5 sequential E2E network hops provide enough time for the SW to activate. With the fast public path, this padding is gone.

##### Research Insight: SW Cache Eviction on Privacy Toggle

The SW cache has no eviction mechanism. A visitor who loaded a public page retains the full file bundle in their browser indefinitely. Even after `public: false`, the SW serves cached content at `/p/assets/{slug}/index.html`.

**Fix**: Include a version/hash in the cache key. When the shell caches files, include a content hash. On the next visit, the shell checks if the hash matches — if not, evict and re-fetch. If the page is now private, the public fetch fails and the stale cache is not used.

##### Research Insight: Storage Bridge for Public Pages

Public pages have no E2E keys, so the storage bridge (postMessage → encrypted relay → agent) cannot work. If a public page tries `window.parent.postMessage({type: 'yourbro-storage', ...})`, the shell has no `aesKey` and the request fails.

**Fix**: The storage bridge listener should not be installed for public pages. Or if installed, immediately respond with `{ok: false, error: 'Storage not available for public pages'}`.

#### Phase 4: Dashboard toggle (DEFERRED)

Per simplicity review, defer this to a follow-up. The core feature works without it:
- ClawdBot sets `"public": true` in `page.json` when publishing
- Users can manually edit `page.json` via their agent
- Dashboard shows public/private **badge** (read-only) in page list — no toggle needed for v1

When implementing later:
- Toggle sends E2E encrypted relay to `POST /api/page-visibility`
- Agent handler reads/writes `page.json` on disk
- Re-render page list on success

## Security Considerations

### CRITICAL: Iframe Sandbox Risk

The repo research agent surfaced a major finding: the current iframe uses `sandbox="allow-scripts allow-same-origin"` on `yourbro.ai`. This is accepted for private pages because "content comes from the user's own agent." For public pages, **a malicious page author's content runs in the viewer's browser with access to:**

- `yourbro.ai`'s IndexedDB (viewer's X25519 private keys)
- `yourbro.ai`'s session cookies (via same-origin fetch)
- `parent.document` (full DOM access to shell.html)

**Mitigation options (pick one):**

1. **Remove `allow-same-origin` for public pages** — iframe gets opaque origin, cannot access parent's IndexedDB/cookies. But this breaks SW-based serving (opaque origins can't use Service Worker). Would need blob URLs or srcdoc for public pages.

2. **Serve public pages from a separate origin** (e.g., `pages.yourbro.ai`) — `allow-same-origin` grants access to that origin's empty storage, not `yourbro.ai`'s IndexedDB. Requires Cloudflare setup and a separate SW.

3. **Use `sandbox="allow-scripts"` only (no allow-same-origin) for public pages** — simplest. Public pages get inline-only content (no multi-file support via SW). Accept reduced functionality for public pages.

4. **Accept the risk with documentation** — public pages on yourbro.ai are from users you trust enough to visit their URL. Similar trust model to visiting any website. Document that public page JS has access to viewer's yourbro session.

**Recommendation**: Option 1 or 3 for v1. Public pages are likely simpler (single HTML file for portfolios). Multi-file public pages via SW can come later with option 2.

### What's exposed

- **Page content**: Only pages explicitly marked `public: true` in `page.json` on the agent. The agent makes the decision, not the server.
- **Username**: Already public (in the URL).

### Research Insight: Uniform Error Responses

Agent online status must NOT be leaked. The public endpoint returns **404 for all error cases** — user not found, agent offline, page not public, page doesn't exist. No information distinguishing these cases is exposed to unauthenticated callers.

### What's NOT exposed

- **Private pages**: Agent returns 404 for non-public pages. Uniform 404 prevents enumeration.
- **Page list**: The public endpoint serves ONE page at a time by slug. There is no public listing endpoint.
- **Storage data**: Page storage (postMessage bridge) requires E2E encryption. Public pages have no storage access.
- **Agent online status**: Uniform 404 responses prevent detection.

### Rate Limiting (Ships with feature)

Add per-IP rate limiting on `GET /api/public-page/{username}/{slug}`:
- 30 requests/minute per IP using `go-chi/httprate`
- Separate from existing nginx rate limit zone
- Agent-side: no rate limiting needed (singleflight + CDN cache handle concurrent load)

### Research Insight: API-Side Slug Validation

Validate slug format at the API server before constructing the relay path. The agent already validates with `^[a-z0-9-]+$`, but defense in depth requires validation at both layers.

### Abuse Prevention

- Agent only serves pages with `public: true` — no accidental exposure
- API server constructs relay path (not the caller) — prevents path injection
- Singleflight coalescing prevents concurrent relay flooding
- Cloudflare edge caching (`s-maxage=60`) shields agent from traffic spikes
- WebSocket message size limit prevents oversized responses

## Performance Considerations

### Research Insight: WebSocket Message Size Limit (BLOCKING)

Both `hub.go:74` and `client.go:113` enforce 2MB WebSocket read limit. Agent allows 10MB bundles. Binary files are base64-encoded (+33%). A page with >1.2MB original content silently fails.

**Fix**: Increase `SetReadLimit` to 12MB in both files. Add `client_max_body_size 15m;` to nginx for the public page endpoint.

### Research Insight: Concurrent Viewers

Without caching, 100 simultaneous viewers = 100 separate WebSocket relay requests for the same slug. Each triggers full disk reads, base64 encoding, JSON marshaling.

**Fix**: Singleflight + API-level cache + Cloudflare edge caching. With all three:

| Scenario | Without Caching | With Singleflight + CDN |
|---|---|---|
| Portfolio, light traffic (1-5) | Works fine | Works fine |
| Shared on Twitter (50-100) | ~200MB agent memory, upload saturated | 1 relay req per 60s, edge-served |
| HN front page (500-1000) | Agent OOM or timeout cascade | Edge-served, agent untouched |

### Research Insight: ETag Support

Agent computes content hash of page bundle, returns as `ETag`. Shell stores ETag alongside SW cache. On repeat visits, sends `If-None-Match`. Agent returns 304 without reading files.

## Acceptance Criteria

- [x] `page.json` supports `"public": true` field
- [x] Agent `Get` response includes `public` field; `GetPublic` returns 404 if not public
- [x] API has `GET /api/public-page/{username}/{slug}` endpoint (no auth, rate-limited)
- [x] API validates slug format before relay (defense in depth)
- [x] API returns uniform 404 for all error cases (no info leakage)
- [x] Shell branches on cookie presence — no extra round-trip for authenticated users
- [x] Shell awaits SW activation before creating iframe (first-visit race fix)
- [x] Public pages viewable in incognito browser (no account, no pairing)
- [x] Private pages remain fully E2E encrypted — no regression
- [ ] Rate limiting on public endpoint (ships with feature)
- [ ] Singleflight request coalescing on public endpoint
- [x] `Cache-Control: public, s-maxage=60` header for Cloudflare edge caching
- [x] Storage bridge disabled or returns error for public pages
- [x] Iframe sandbox addressed for public pages (see Security section)
- [x] CLAUDE.md updated to carve out public page exception from "never plaintext" rule
- [x] SKILL.md updated to document `"public": true` in page.json

## Files Summary

| File | Action |
|------|--------|
| `agent/internal/handlers/pages.go` | **Modify** — add `readPageMeta`, `GetPublic`, `Public` field in structs |
| `agent/cmd/server/main.go` | **Modify** — add `/api/public-page/{slug}` route |
| `api/cmd/server/main.go` | **Modify** — add inline public page handler outside auth group |
| `web/public/p/shell.html` | **Modify** — branch on auth, await SW activation, disable storage for public |
| `CLAUDE.md` | **Modify** — add public page exception to plaintext relay prohibition |
| `skill/SKILL.md` | **Modify** — document `"public": true` in page.json |

**Deferred to follow-up:**

| File | Action |
|------|--------|
| `web/src/pages/dashboard.ts` | Add public/private toggle per page |
| `agent/internal/handlers/pages.go` | Add `SetVisibility` handler |
| `agent/cmd/server/main.go` | Add `/api/page-visibility` route |

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `page.json` missing `public` field | Defaults to `false` (private) — Go zero value for `bool` |
| Agent offline + public page | Uniform 404 (no status leakage) |
| Page made private while viewer is on it | Current SW-cached session works; next load gets 404 |
| Multiple agents for same user | API tries all online agents until one returns 200 |
| `page.json` doesn't exist | Treated as private (title falls back to slug, public to false) |
| Public page with storage calls | Storage bridge returns error: "not available for public pages" |
| Public page with malicious JS | See iframe sandbox section — must mitigate before shipping |
| Concurrent 100 viewers of same page | Singleflight coalesces to 1 relay request; CDN caches for 60s |
| Page bundle > 2MB | Must increase WS read limit to 12MB before shipping |
| First-time visitor (no SW) | Shell awaits SW activation before creating iframe |

## Relevant Learnings (from docs/solutions/)

### E2E Encrypted Relay Integration

From `docs/solutions/integration-issues/e2e-encrypted-relay-agent-sandboxed-iframe-integration.md`:
- "Each layer has one job" — don't duplicate auth between layers
- Relay API should be a pure pipe — return consistent JSON envelope
- Public endpoint follows this: API constructs the relay path, agent decides access

### Cloudflare Transform Rules

From `docs/solutions/deployment-issues/cloudflare-transform-rules-zone-wide-scope-breaks-api.md`:
- All Cloudflare rules must include `http.host eq "yourbro.ai"` filter
- The public page route at `api.yourbro.ai` is NOT affected by Transform Rules (they're scoped to `yourbro.ai`), but verify this during deployment

### Incomplete Key Revocation

From `docs/solutions/security-issues/incomplete-agent-key-revocation-on-removal.md`:
- Multi-system state changes must be atomic or explicitly handled
- The visibility toggle (when implemented) should be idempotent — setting `public: true` when already public is a no-op

## References

- `agent/internal/handlers/pages.go:63-149` — current page bundle handler
- `agent/internal/handlers/pages.go:152-164` — current `readTitle` (to be replaced with `readPageMeta`)
- `api/internal/handlers/relay.go:21-72` — current auth-required relay (pattern reference)
- `api/cmd/server/main.go:275-389` — API route definitions (auth group)
- `web/public/p/shell.html:23-325` — current shell flow
- `agent/internal/relay/router.go:27-34` — encrypted vs cleartext request handling
- `agent/internal/relay/router.go:130-141` — allowed relay path prefixes
- `api/internal/relay/hub.go:74` — 2MB WebSocket read limit (must increase)
- `agent/internal/relay/client.go:113` — 2MB WebSocket read limit (must increase)

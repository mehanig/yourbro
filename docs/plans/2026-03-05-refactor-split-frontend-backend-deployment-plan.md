---
title: "refactor: Split frontend and backend into separate deployments"
type: refactor
status: completed
date: 2026-03-05
deepened: 2026-03-05
---

# Split Frontend and Backend into Separate Deployments

## Enhancement Summary

**Deepened on:** 2026-03-05
**Sections enhanced:** 5 phases + acceptance criteria
**Research agents used:** Security Sentinel, Architecture Strategist, Deployment Verification, TypeScript Reviewer, Code Simplicity Reviewer, Performance Oracle, Framework Docs Researcher, Learnings Researcher

### Key Improvements
1. **Migration step reordering**: Google OAuth redirect URI must be added to Console BEFORE frontend goes live (was step 6, now step 2)
2. **Simplified /p/ page hosting**: Keep page rendering on Go server, use Cloudflare redirect rule — eliminates Phase 1.3 and Phase 2.4 entirely
3. **Cookie-only auth opportunity**: Moving to cookie-only auth eliminates CORS preflights on GET requests
4. **CSP fix for sandboxed iframes**: `connect-src 'self'` resolves to opaque origin after split — must use explicit `https://api.yourbro.ai`

### Critical Issues Discovered
- **Logout cookie bug**: Current logout handler doesn't set `Domain` attribute — won't clear cross-subdomain cookie
- **ensure_env limitation**: Won't update existing `GOOGLE_REDIRECT_URL` — needs explicit `sed` replacement
- **SSL mode ordering**: Change SSL mode to "Full (Strict)" AFTER Origin CA cert is installed, not before
- **OAuth CSRF**: State parameter in `/auth/google` is user-controlled, not cryptographically validated

## Overview

Currently the yourbro frontend (web/) is embedded into the Go binary via `//go:embed static/*` and deployed as a single Docker container. This plan splits them:

- **Frontend**: Static site deployed to Cloudflare Workers with static assets at `yourbro.ai`
- **Backend API**: Go server deployed to Hetzner VPS at `api.yourbro.ai`

This follows the same pattern as hunder-app (R2 + Transform Rules), but uses Cloudflare Workers with static assets for native SPA fallback support.

## Problem Statement / Motivation

- Single Docker image contains both frontend and API, coupling their deploy cycles
- Any frontend change (CSS tweak, copy update) requires rebuilding the entire Go binary
- Frontend could be served from a global CDN edge network (Cloudflare) instead of a single VPS
- Separating concerns enables independent scaling and deployment

## Architecture After Split

```
                    yourbro.ai (Cloudflare)
                    ┌─────────────────────┐
Browser ──HTTPS──▶  │  Workers + Static   │  ◀── R2 bucket (static assets)
                    │  Assets (SPA)       │
                    └─────────────────────┘
                              │
                    api.yourbro.ai (Cloudflare proxy)
                              │
                    ┌─────────────────────┐
                    │  Hetzner VPS        │
                    │  ┌───────────────┐  │
                    │  │ nginx (SSL)   │  │
                    │  │  ↓            │  │
                    │  │ Go API :8080  │  │
                    │  │  ↓            │  │
                    │  │ PostgreSQL    │  │
                    │  └───────────────┘  │
                    └─────────────────────┘
```

## Technical Approach

### Phase 1: Backend — Prepare API for Cross-Origin

Make the API work independently at `api.yourbro.ai` before touching the frontend deployment.

#### 1.1 Cookie Configuration for Cross-Subdomain

**File:** `api/cmd/server/main.go`

Change the `yb_session` cookie to work across subdomains:

```go
// Before (same-origin):
http.SetCookie(w, &http.Cookie{
    Name:     "yb_session",
    Value:    token,
    Path:     "/",
    HttpOnly: true,
    Secure:   os.Getenv("ENVIRONMENT") == "production",
    SameSite: http.SameSiteLaxMode,
    MaxAge:   7 * 24 * 60 * 60,
})

// After (cross-subdomain):
http.SetCookie(w, &http.Cookie{
    Name:     "yb_session",
    Value:    token,
    Domain:   getEnv("COOKIE_DOMAIN", ""),  // ".yourbro.ai" in prod, empty for local
    Path:     "/",
    HttpOnly: true,
    Secure:   true,
    SameSite: http.SameSiteLaxMode,
    MaxAge:   7 * 24 * 60 * 60,
})
```

Key insight from research: `yourbro.ai` ↔ `api.yourbro.ai` cookies are **first-party** (same registrable domain). `SameSite=Lax` works — no need for `SameSite=None`. Third-party cookie deprecation does NOT affect this.

- [x] Update `Set-Cookie` in OAuth callback handler (line 215)
- [x] Update `Set-Cookie` in logout handler (line 234)
- [x] Add `COOKIE_DOMAIN` env var (empty for local dev, `yourbro.ai` for prod)
- [x] Make `Secure: true` unconditional (remove ENVIRONMENT check)

#### 1.2 CORS Configuration

**File:** `api/cmd/server/main.go`

CORS is already configurable via `FRONTEND_URL` env var. Just ensure it's set correctly:

- [x] Production: `FRONTEND_URL=https://yourbro.ai`
- [x] Local dev: `FRONTEND_URL=http://localhost:5173` (already the default)
- [x] Keep `"null"` origin for sandboxed iframes

No code changes needed — just env var configuration.

> **Research Insight — CORS Performance (Performance Oracle):** Increase `MaxAge` from 300 to 86400 (24h) to reduce preflight frequency. Also, CORS with `AllowCredentials: true` requires exact origin match (not `*`) — already the case with `FRONTEND_URL`.

> **Research Insight — Cookie-Only Auth (Performance Oracle):** Consider migrating from `Authorization: Bearer` header to cookie-only auth for browser requests. This eliminates CORS preflights on simple GET requests (cookies are sent automatically). The `Authorization` header triggers preflights on every cross-origin request. Keep Bearer auth only for agent WebSocket connections.

#### 1.3 ~~New Public Endpoint: Resolve Page by Username+Slug~~ → SIMPLIFIED: Keep /p/ on Go Server

> **Research Insight — Simplification (Code Simplicity Reviewer):** Instead of building a new client-side page host, keep the existing Go-rendered `/p/:username/:slug` pages on the API server. Add a Cloudflare redirect rule: `yourbro.ai/p/*` → `api.yourbro.ai/p/*`. This eliminates the need for Phase 1.3 AND Phase 2.4 entirely. The Go template already works, has SDK injection, and handles CSP correctly.

**Cloudflare Page Rule or Redirect Rule:**
```
If URL matches: yourbro.ai/p/*
Then: Forward to https://api.yourbro.ai/p/$1 (301 or proxy)
```

This means:
- ~~Add `GET /p-data/{username}/{slug}` public endpoint~~ — not needed
- ~~Create `page-host.ts`~~ — not needed
- The existing `RenderPage` and `RenderPageContent` handlers stay as-is
- CSP `connect-src 'self'` continues to work (iframe served from `api.yourbro.ai`)
- SDK inline injection continues to work

**Only if the simplification above is rejected**, implement the original plan:

<details>
<summary>Original Phase 1.3: New Public Endpoint (click to expand)</summary>

**File:** `api/internal/handlers/pages.go`

The static page host needs to resolve `username/slug` to page metadata via API. Currently `GetPageByUserAndSlug` exists in storage but has no public HTTP handler.

- [ ] Add `GET /p-data/{username}/{slug}` public endpoint (no auth required)
- [ ] Returns: `{ id, title, slug, username, agent_id, has_agent }`
- [ ] This replaces the Go template's server-side data injection

```go
// New handler on PagesHandler
func (h *PagesHandler) ResolvePageBySlug(w http.ResponseWriter, r *http.Request) {
    username := chi.URLParam(r, "username")
    slug := chi.URLParam(r, "slug")
    page, err := h.DB.GetPageByUserAndSlug(r.Context(), username, slug)
    if err != nil {
        http.Error(w, "Page not found", http.StatusNotFound)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "id":       page.ID,
        "title":    page.Title,
        "slug":     page.Slug,
        "username": username,
        "agent_id": page.AgentID,
    })
}
```

- [ ] Register route: `r.Get("/p-data/{username}/{slug}", pagesHandler.ResolvePageBySlug)`

</details>

#### 1.4 Remove Frontend Embedding from Go Server

**File:** `api/cmd/server/main.go`

- [x] Remove `//go:embed static/*` directive and `staticFiles` var (line 35-36)
- [x] Keep `//go:embed migrations/*.sql` (line 38-39)
- [x] Remove SDK loading from embedded files (lines 125-131) — SDK will be loaded differently (see 1.5)
- [x] Remove SPA fallback `NotFound` handler (lines 388-408)
- [x] Remove `"embed"`, `"io/fs"` imports if no longer used

#### 1.5 SDK Script Distribution

The SDK (`clawd-storage.js`) is currently embedded in the Go binary and inlined into page content for sandboxed iframes. After splitting:

**Option chosen:** Keep SDK embedded in Go binary for inline injection.

- [x] Move SDK embed to a dedicated directive: `//go:embed sdk/clawd-storage.js`
- [x] Create `api/cmd/server/sdk/` directory and copy built SDK there during Docker build
- [x] Update Dockerfile to copy SDK into this path instead of `static/sdk/`
- [ ] `PagesHandler.SDKScript` continues to work as before — no changes to `RenderPageContent`

> **Research Insight — SDK Embed (Code Simplicity Reviewer):** Simplify to `//go:embed sdk/clawd-storage.js` as a single `[]byte` variable instead of an `embed.FS`. One-line change, no directory traversal needed.

> **Research Insight — CSP for Sandboxed Iframes (Architecture Strategist + Learnings):** After the split, if `/p/` pages stay on `api.yourbro.ai` (per simplification above), `connect-src 'self'` still works because the iframe is served from the same origin. If `/p/` moves to the frontend, CSP must change to `connect-src https://api.yourbro.ai` because `'self'` in a sandboxed iframe resolves to opaque origin `null`.

#### 1.6 Update OAuth Post-Login Redirect

**File:** `api/cmd/server/main.go` (line 225)

Already uses `frontendURL` env var:
```go
http.Redirect(w, r, frontendURL+"/#/callback?token="+token, http.StatusTemporaryRedirect)
```

- [x] Ensure `FRONTEND_URL=https://yourbro.ai` in production .env
- [x] Update `GOOGLE_REDIRECT_URL=https://api.yourbro.ai/auth/google/callback` (API domain now)
- [ ] Update Google Cloud Console authorized redirect URIs to `https://api.yourbro.ai/auth/google/callback` (manual step)

> **Research Insight — OAuth Security (Security Sentinel):**
> - **HIGH**: The `state` parameter in `/auth/google` is user-controlled (`r.URL.Query().Get("state")`) and not cryptographically validated on callback. This allows CSRF on login. Fix: generate a random state, store in session/cookie, validate on callback.
> - **MEDIUM**: JWT token is exposed in the redirect URL (`/#/callback?token=xxx`). Consider setting the session cookie in the callback and redirecting without the token in the URL. The cookie is already set (line 215-223), so the `?token=` param may be redundant.
> - **MEDIUM**: Logout handler (line 234) doesn't set `Domain` attribute on the cookie clear — after adding `Domain` to the session cookie, logout won't work unless the clear also specifies the same `Domain`.

> **Research Insight — OAuth Redirect URI Ordering (Deployment Verification):** Add the new redirect URI (`https://api.yourbro.ai/auth/google/callback`) to Google Cloud Console BEFORE deploying the frontend split. Google allows multiple redirect URIs simultaneously. Remove the old one only after migration is verified stable.

### Phase 2: Frontend — Cross-Origin API Calls

#### 2.1 Configure API Base URL

**File:** `web/src/lib/api.ts`

```typescript
// Before:
const API_BASE = "";

// After:
const API_BASE = import.meta.env.VITE_API_URL || "";
```

- [x] Add `VITE_API_URL` env var support
- [x] Export `API_BASE` as a named export so other files import it (don't duplicate the env var read)
- [x] Create `web/.env.production` with `VITE_API_URL=https://api.yourbro.ai`
- [x] Local dev: empty (Vite proxy handles it), or `web/.env.development` with empty value
- [x] Create `web/src/env.d.ts` for typed env vars:
  ```typescript
  /// <reference types="vite/client" />
  interface ImportMetaEnv {
    readonly VITE_API_URL: string;
  }
  ```

> **Research Insight — TypeScript (TypeScript Reviewer):**
> - Export `API_BASE` once from `api.ts` — all other files import it. No duplicating `import.meta.env.VITE_API_URL` across files.
> - Fix `request<T>` to handle 204 No Content: `res.status === 204 ? (undefined as T) : await res.json()` — currently always calls `res.json()` which throws on empty body.
> - Create a `relayRequest()` helper for the relay fetch calls in dashboard.ts (currently raw `fetch` with no error handling).

#### 2.2 Add `credentials: 'include'` to API Requests

**File:** `web/src/lib/api.ts`

The `request()` helper needs to send cookies cross-origin for the SSE fallback:

```typescript
// In the request() function, add credentials
const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body,
    credentials: 'include',  // Send cookies cross-origin
});
```

- [x] Add `credentials: 'include'` to the `request()` helper

#### 2.3 Fix Hardcoded API Paths

**File:** `web/src/pages/login.ts`

- [ ] Change `/auth/google` links to use API_BASE:
  ```typescript
  // Import or reference API_BASE
  const apiBase = import.meta.env.VITE_API_URL || '';
  // In template:
  `<a href="${apiBase}/auth/google">Sign in with Google</a>`
  ```

**File:** `web/src/pages/dashboard.ts`

- [x] Line 85: Refactor `fetch(\`/api/relay/${id}\`)` to use API_BASE + credentials
- [x] Line 218: Update SSE EventSource:
  ```typescript
  const apiBase = import.meta.env.VITE_API_URL || '';
  activeSSE = new EventSource(`${apiBase}/api/agents/stream`, {
      withCredentials: true,
  });
  ```
- [x] Line 248: Refactor logout to use `logout()` from api.ts
- [x] Line 328: Refactor relay `fetch(\`/api/relay/${agentId}\`)` to use API_BASE + credentials

> **Research Insight — SSE Cross-Origin (Learnings + Performance Oracle):**
> - `EventSource` with `withCredentials: true` sends cookies cross-origin. This works with the subdomain cookie setup.
> - SSE auth currently uses query param (`?token=`) because `EventSource` can't set headers. With cross-subdomain cookies, cookie auth may suffice — but keep the query param as fallback for edge cases.
> - Add `retry:` field in SSE responses to control browser reconnect timing (default is 3s). Let EventSource use its native reconnection instead of custom logic.
> - Nginx must have `proxy_buffering off` for the SSE endpoint (already in the plan).

**File:** `web/src/pages/how-to-use.ts`

- [x] Check for any hardcoded API paths and update

#### 2.4 ~~Create Static Page Host~~ → ELIMINATED (see Phase 1.3 simplification)

> **Research Insight — Simplification:** If `/p/` page hosting stays on the Go server (Phase 1.3 simplification), this entire section is eliminated. A Cloudflare redirect rule handles routing `yourbro.ai/p/*` → `api.yourbro.ai/p/*`.

<details>
<summary>Original Phase 2.4 (only if Phase 1.3 simplification is rejected)</summary>

**File:** `web/src/pages/page-host.ts` (new file)

Replace the server-rendered Go template (`/p/:username/:slug`) with a client-side page that:

1. Parses `username` and `slug` from the URL path
2. Calls `GET api.yourbro.ai/p-data/:username/:slug` to get page metadata
3. Creates the sandboxed iframe pointing to `api.yourbro.ai/api/pages/{id}/content?token=...`
4. Handles postMessage for crypto key exchange (same logic as current Go template)

- [ ] Create `page-host.ts` with the page host logic
- [ ] Add route `#/p/:username/:slug` to the router (or handle `/p/` paths)
- [ ] Move crypto key reading (IndexedDB) and postMessage logic from Go template to TypeScript
- [ ] Update iframe `src` to use full API URL: `${API_BASE}/api/pages/${pageId}/content?token=${token}`

**Note:** IndexedDB keypairs are origin-scoped. Since both dashboard and page host will be on `yourbro.ai`, keypairs stored by the dashboard will be accessible to the page host. This works.

</details>

#### 2.5 Update Vite Config

**File:** `web/vite.config.ts`

The proxy config stays the same for local dev (API at localhost:8080):

```typescript
proxy: {
    "/api": "http://localhost:8080",
    "/auth": "http://localhost:8080",
    "/p-data": "http://localhost:8080",
},
```

- [ ] Add `/p-data` proxy rule
- [ ] Remove `/p` proxy rule (page host is now client-side)

### Phase 3: Deployment Pipeline

#### 3.1 Split Dockerfile

**File:** `Dockerfile`

The current multi-stage Dockerfile builds frontend, SDK, and Go API together. Split into:

**API Dockerfile** (`Dockerfile` — modify existing):
- Keep SDK build stage (needed for inline injection)
- Remove frontend build stage
- Copy SDK output to `api/cmd/server/sdk/`
- Copy migrations to `api/cmd/server/migrations/`
- Build Go binary

```dockerfile
# Stage 1: Build SDK
FROM node:20-alpine AS sdk
WORKDIR /build
COPY sdk/ ./sdk/
RUN cd sdk && npm ci && npm run build

# Stage 2: Build Go API
FROM golang:1.24-alpine AS builder
WORKDIR /build
COPY api/ ./api/
COPY --from=sdk /build/sdk/dist/clawd-storage.js ./api/cmd/server/sdk/clawd-storage.js
COPY migrations/ ./api/cmd/server/migrations/
RUN cd api && CGO_ENABLED=0 go build -o /yourbro ./cmd/server

# Stage 3: Runtime
FROM alpine:3.21
COPY --from=builder /yourbro /yourbro
CMD ["/yourbro"]
```

- [x] Remove frontend build stage from Dockerfile
- [x] Update `COPY` paths for SDK (to `sdk/` instead of `static/sdk/`)
- [x] Update Go embed directive to match new path

#### 3.2 Frontend CI/CD — GitHub Actions

**File:** `.github/workflows/web-deploy.yml` (new file)

Follow hunder-app pattern: build → sync to R2 → update Cloudflare Transform Rules (or deploy Workers).

**Option A: Cloudflare Workers with Static Assets (Recommended)**

```yaml
name: Deploy Frontend
on:
  push:
    branches: [main]
    paths: ['web/**', 'sdk/**']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Build SDK
        run: cd sdk && npm ci && npm run build

      - name: Build Frontend
        run: cd web && npm ci && npm run build
        env:
          VITE_API_URL: https://api.yourbro.ai

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: web
```

**File:** `web/wrangler.toml` (new file)

```toml
name = "yourbro-frontend"
compatibility_date = "2026-03-05"

routes = [
  { pattern = "yourbro.ai", custom_domain = true }
]

[assets]
directory = "./dist/"
html_handling = "force-trailing-slash"
not_found_handling = "single-page-application"
```

- [x] Create `web/wrangler.toml` with SPA routing config
- [x] Create `.github/workflows/web-deploy.yml`
- [ ] Set up GitHub Secrets: `CLOUDFLARE_API_TOKEN` (manual step)

> **Research Insight — Workers Deploy Strategy (Deployment Verification):** Deploy Workers WITHOUT `custom_domain` first. Test on the auto-generated `.workers.dev` URL. Only add `custom_domain` after verifying the build works. This prevents breaking the live site during initial setup.

> **Research Insight — Cache Headers (Performance Oracle + Framework Docs):** Add a `web/public/_headers` file for Cloudflare:
> ```
> /assets/*
>   Cache-Control: public, max-age=31536000, immutable
> /index.html
>   Cache-Control: no-cache
> ```
> Vite hashes asset filenames, so `immutable` is safe for `/assets/*`. `index.html` should never be cached.

> **Research Insight — Remove Option B (Code Simplicity Reviewer):** Option B (R2 + Transform Rules) adds decision paralysis. Workers with static assets is strictly better for this use case — native SPA fallback, no Transform Rules to manage, simpler CI/CD. Remove Option B.

~~**Option B: R2 + Transform Rules (hunder-app pattern)**~~

~~If Workers are not preferred, follow the exact hunder-app pattern with versioned R2 builds and Transform Rules. This is more manual but avoids Worker cold starts.~~

~~- [ ] Decide: Workers (simpler) vs R2+Transform Rules (proven pattern from hunder-app)~~

**Decision: Workers with Static Assets (Option A).** Option B removed per simplicity review.

#### 3.3 Update Backend CI/CD

**File:** `.github/workflows/deploy.yml` (modify existing)

- [x] Remove frontend build from Docker build triggers (or keep but it no longer embeds frontend)
- [x] Update trigger paths: remove `web/**`, keep `api/**`, `sdk/**`, `migrations/**`
- [x] Update `.env` injection in deploy script:
  - `FRONTEND_URL=https://yourbro.ai`
  - `GOOGLE_REDIRECT_URL=https://api.yourbro.ai/auth/google/callback`
  - `COOKIE_DOMAIN=yourbro.ai`

> **Research Insight — ensure_env Limitation (Deployment Verification):** The `ensure_env()` function only adds missing vars — it won't update `GOOGLE_REDIRECT_URL` because it already has a value. Use explicit `sed` replacement:
> ```bash
> sed -i "s|GOOGLE_REDIRECT_URL=.*|GOOGLE_REDIRECT_URL=https://api.yourbro.ai/auth/google/callback|" .env
> ```

#### 3.4 DNS Configuration

In Cloudflare dashboard:

- [ ] `yourbro.ai` → Cloudflare Workers route (or R2 + Transform Rules)
- [ ] `api.yourbro.ai` → A record pointing to Hetzner VPS IP, proxied (orange cloud)
- [ ] Cloudflare Universal SSL automatically covers `*.yourbro.ai`

#### 3.5 SSL for api.yourbro.ai

Cloudflare handles edge SSL automatically. For origin SSL (Cloudflare → VPS):

- [ ] Generate Cloudflare Origin CA certificate (covers `*.yourbro.ai`, 15-year validity)
- [ ] Install on VPS at `/etc/ssl/yourbro/`
- [ ] Set Cloudflare SSL/TLS mode to "Full (Strict)" — **IMPORTANT: Do this AFTER installing the Origin CA cert, not before** (Deployment Verification)
- [ ] No Let's Encrypt needed

#### 3.6 Update Nginx on VPS

**File:** `deploy/nginx.conf`

Update to serve API only (no static files):

```nginx
server {
    listen 443 ssl;
    server_name api.yourbro.ai;

    ssl_certificate     /etc/ssl/yourbro/origin-cert.pem;
    ssl_certificate_key /etc/ssl/yourbro/origin-key.pem;

    # API routes
    location / {
        proxy_pass http://api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws/ {
        proxy_pass http://api:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # SSE (disable buffering)
    location /api/agents/stream {
        proxy_pass http://api:8080;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection "";
    }
}
```

- [x] Update `server_name` to `api.yourbro.ai`
- [x] Remove any static file serving rules
- [x] Update SSL cert paths to Cloudflare Origin CA

### Phase 4: Migration Strategy (Zero-Downtime)

> **Research Insight — Reordered Steps (Deployment Verification):** Original had Google OAuth update as step 6 (after frontend was live). This is a **critical ordering error** — OAuth breaks if the redirect URI isn't registered before the API starts using the new domain. Reordered below.

Execute in this order to avoid downtime:

1. **Update Google Cloud Console** redirect URI **(DO THIS FIRST)**
   - Add `https://api.yourbro.ai/auth/google/callback` as an additional authorized redirect URI
   - Keep the old URI (`https://yourbro.ai/auth/google/callback`) — Google allows multiple
   - Verify both URIs are listed before proceeding

2. **Deploy API changes** (Phase 1) — API still serves frontend (backward compatible)
   - Cookie changes are backward compatible (adding Domain doesn't break same-origin)
   - CORS changes are additive (new FRONTEND_URL accepted alongside old)
   - Update `GOOGLE_REDIRECT_URL` env var via `sed` (not `ensure_env`)

3. **Set up `api.yourbro.ai`** DNS in Cloudflare pointing to VPS
   - Install Origin CA cert on VPS FIRST
   - Then set SSL mode to "Full (Strict)"
   - Both `yourbro.ai` and `api.yourbro.ai` now reach the same VPS
   - Verify: `curl https://api.yourbro.ai/health`

4. **Deploy frontend to Cloudflare Workers** (Phase 3.2)
   - Deploy WITHOUT `custom_domain` first — test on `.workers.dev` URL
   - Verify login, dashboard, SSE, relay pairing all work
   - Only then add `custom_domain` in wrangler.toml

5. **Switch `yourbro.ai` DNS** from VPS to Cloudflare Workers
   - Frontend now served from CDN edge
   - API calls go to `api.yourbro.ai` (VPS)
   - Add Cloudflare redirect rule: `yourbro.ai/p/*` → `api.yourbro.ai/p/*` (if using /p/ simplification)

6. **Remove frontend embedding from Go binary** (Phase 1.4)
   - Wait 24h after DNS switch is confirmed working (Deployment Verification recommendation)
   - Deploy updated API Docker image

7. **Clean up**
   - Remove old Google OAuth redirect URI from Console
   - Remove old nginx static file rules, old Dockerfile stages
   - Remove `ensure_env` entries for old vars

> **Research Insight — Rollback Plan (Deployment Verification):** If anything breaks after step 5:
> - Revert DNS for `yourbro.ai` back to VPS (TTL permitting)
> - The Go binary still serves the frontend (not removed until step 6)
> - This is why step 6 has a 24h buffer

### Phase 5: Local Development Updates

#### 5.1 Docker Compose Changes

**File:** `docker-compose.local.yml`

- [x] Remove frontend-related env vars from API service
- [x] Add `COOKIE_DOMAIN` (empty for local)
- [x] `FRONTEND_URL` stays `http://localhost:5173`

Local dev workflow:
- Run `docker compose ... up --build` for API + PostgreSQL
- Run `cd web && npm run dev` (Vite on :5173 with proxy to :8080)
- Vite proxy handles `/api/*` and `/auth/*` → localhost:8080

> **Research Insight — CLAUDE.md Compliance (Code Simplicity Reviewer):** The local dev workflow above suggests running `npm run dev` locally, which contradicts CLAUDE.md's "ALL builds via Docker Compose" rule. For local *development* (not builds), Vite dev server is standard — but clarify in CLAUDE.md that `npm run dev` is for dev server only, production builds still go through Docker/CI.

#### 5.2 Update CLAUDE.md

- [x] Document two-pipeline build process
- [x] Add frontend deploy instructions
- [x] Note that `web/` no longer builds in Docker

## Files to Modify

### Backend (api/)

| File | Change |
|------|--------|
| `api/cmd/server/main.go` | Remove static embed, SPA handler, update cookie config, add `/p-data/` route |
| `api/internal/handlers/pages.go` | Add `ResolvePageBySlug` handler |
| `Dockerfile` | Remove frontend build stage, update SDK path |

### Frontend (web/)

| File | Change |
|------|--------|
| `web/src/lib/api.ts` | Add `VITE_API_URL`, `credentials: 'include'` |
| `web/src/pages/login.ts` | Use API_BASE for auth links |
| `web/src/pages/dashboard.ts` | Fix hardcoded paths, EventSource withCredentials |
| `web/src/pages/page-host.ts` | **New** — client-side page host replacing Go template |
| `web/vite.config.ts` | Update proxy rules |
| `web/.env.production` | **New** — `VITE_API_URL=https://api.yourbro.ai` |
| `web/wrangler.toml` | **New** — Cloudflare Workers config |

### Infrastructure

| File | Change |
|------|--------|
| `.github/workflows/web-deploy.yml` | **New** — frontend deploy to Cloudflare |
| `.github/workflows/deploy.yml` | Update triggers, env vars |
| `deploy/nginx.conf` | Update server_name, remove static serving |
| `docker-compose.local.yml` | Add COOKIE_DOMAIN |
| `.env.example` | Add COOKIE_DOMAIN, update GOOGLE_REDIRECT_URL |
| `CLAUDE.md` | Document new build process |

## Acceptance Criteria

### Functional Requirements

- [ ] Frontend loads from `yourbro.ai` via Cloudflare CDN
- [ ] API responds at `api.yourbro.ai/health`
- [ ] Google OAuth login works end-to-end (redirect to api.yourbro.ai, callback, redirect back to yourbro.ai)
- [ ] Dashboard loads and shows authenticated user
- [ ] SSE agent stream works cross-origin (real-time agent status updates)
- [ ] Page hosting works at `yourbro.ai/p/:username/:slug`
- [ ] Relay pairing works from dashboard
- [ ] E2E encryption works (keypairs from IndexedDB accessible to page host)
- [ ] Logout clears both cookie and localStorage
- [ ] Agent WebSocket connection works at `api.yourbro.ai/ws/agent`

### Non-Functional Requirements

- [ ] Frontend deploy completes in < 2 minutes (no Docker build)
- [ ] API deploy is independent of frontend changes
- [ ] Local development works with Vite proxy (no Cloudflare needed)
- [ ] Zero downtime during migration (phased rollout)

### Quality Gates

- [ ] Docker Compose local build succeeds
- [ ] CORS preflight returns correct headers
- [ ] Cookie set with correct Domain attribute
- [ ] EventSource reconnects on disconnect

## Gotchas (from docs/solutions/ + Research Agents)

- **OAuth env vars**: `ensure_env()` only adds missing vars — use `sed` to update existing `GOOGLE_REDIRECT_URL` (from `google-oauth-missing-env-vars-production-deploy.md` + Deployment Verification)
- **TLS scheme in relay router**: Synthetic HTTP requests need `r.TLS = &tls.ConnectionState{}` (from `relay-router-tls-scheme-mismatch-401.md`)
- **CORS "null" origin**: Keep for sandboxed iframes — SDK in iframe has origin `null` (from `e2e-encrypted-relay-agent-sandboxed-iframe-integration.md`)
- **Subdomain cookies are first-party**: `SameSite=Lax` works. Do NOT use `SameSite=None` (browser research confirms)
- **Cloudflare handles SSL**: Use Origin CA cert, not Let's Encrypt. Set SSL mode to "Full (Strict)" AFTER cert install
- **`__Host-` cookie prefix forbids Domain**: Use `__Secure-` prefix if you want a prefixed cookie name
- **Logout cookie must match Domain**: If session cookie has `Domain=yourbro.ai`, the clear cookie must also set `Domain=yourbro.ai` (Security Sentinel)
- **OAuth state CSRF**: Current state parameter is user-controlled. Fix during this refactor or as a follow-up (Security Sentinel)
- **SSE query param auth**: `EventSource` can't set `Authorization` headers — uses cookie or `?token=` query param. With cross-subdomain cookies and `withCredentials: true`, cookies should work (Learnings)
- **SDK must be inlined as IIFE**: In sandboxed iframes, SDK can't be loaded via `<script src>` from a different origin. Keep inline injection in Go template (Learnings)
- **CryptoKey non-extractable**: Keys generated with `extractable: false` can't be serialized. For cross-tab relay, use `postMessage` to pass `CryptoKey` objects (Learnings)
- **IndexedDB is origin-scoped**: After split, dashboard and page host on same origin (`yourbro.ai`) share IndexedDB. If /p/ pages stay on `api.yourbro.ai`, they DON'T share — but they don't need to since iframe content is served from API (Learnings)

## References

- hunder-app R2 deploy workflow: `../hunder-app/.github/workflows/web-deploy.yml`
- hunder-app frontend config: `../hunder-app/web/src/config.ts`
- Cloudflare Workers static assets SPA routing: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- web.dev first-party cookie recipes: https://web.dev/articles/first-party-cookie-recipes
- Cloudflare Origin CA certificates: https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/

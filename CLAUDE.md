# yourbro

## Build & Run

### Architecture
- **Frontend** (`web/`): Static site deployed to Cloudflare R2 at `yourbro.ai` (versioned builds with Transform Rules)
- **Backend API** (`api/`): Go server deployed to Hetzner VPS at `api.yourbro.ai`
- **Agent** (`agent/`): Go server connecting to API via WebSocket relay. Built via `Dockerfile.agent`. Released as ClawdBot skill binary via GitHub Releases.

### Local development

API + database via Docker Compose:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.local.yml up --build
```

Frontend dev server (separate terminal):
```bash
cd web && npm run dev
```
Vite runs on :5173 with proxy to API at :8080.

Agent (local, connects to local API via nginx):
```bash
docker compose -f docker-compose.agent.yml up --build
```
Requires `agent/.env` with `YOURBRO_TOKEN` and `YOURBRO_SERVER_URL=http://nginx`.

Agent (prod, connects to production API):
```bash
docker compose -f docker-compose.agent-prod.yml up --build
```
Requires `agent-prod.env` with `YOURBRO_TOKEN` and `YOURBRO_SERVER_URL=https://yourbro.ai`.

Production API builds must be done via Docker Compose. Never run `go build` locally.

### Production deploy
- **API**: Pushed via `.github/workflows/deploy.yml` (triggers on `api/`, `sdk/`, `migrations/`, `deploy/` changes)
- **Frontend**: Pushed via `.github/workflows/web-deploy.yml` (triggers on `web/`, `sdk/` changes)
- **Agent**: Released via `.github/workflows/release-skill.yml` (triggers on `v*` tags or manual dispatch). Builds cross-platform binaries (linux/amd64, darwin/arm64) and creates a GitHub Release with the skill package. **Agent changes do NOT autodeploy** — you must tag a release.

The API `Dockerfile` builds SDK and Go API. Frontend is NOT embedded — it deploys independently to Cloudflare R2.
`/p/{username}/{slug}` page routes are served by a static shell (`web/public/p/shell.html`) from R2 via Cloudflare Transform Rule. The shell stays on `yourbro.ai` (same origin for IndexedDB access) and makes cross-origin API calls to `api.yourbro.ai`. SDK is also served from R2 at `/sdk/clawd-storage.js`.

### Pages architecture
- Pages are **directory-based**: each page is a folder at `/data/yourbro/pages/{slug}/` with `index.html` + assets (JS, CSS, etc.)
- Pages are multi-file by design. **NEVER suggest inlining assets** — the entire point is separate JS/CSS files served via Service Worker.
- A Service Worker (`web/public/p/page-sw.js`) caches the file bundle and serves sub-resources at `/p/assets/{slug}/*`
- The shell (`web/public/p/shell.html`) enriches `index.html` with meta tags + SDK, caches the enriched bundle in the SW, then sets `iframe.src = "/p/assets/{slug}/index.html"` — the SW serves it. Relative URLs resolve naturally from the iframe's actual URL (no `<base>` tag needed).
- `sandbox="allow-scripts allow-same-origin"` is required for the iframe to use the parent's Service Worker
- `postMessage` keypair transport delivers crypto keys to the iframe on `load`
- Cloudflare Transform Rules: the `/p/*` shell rule excludes `.js`, `.css`, `.json` extensions so the SW file and cached assets are served correctly (not rewritten to shell.html)

### Auth
- Browser auth uses httpOnly `yb_session` cookie (cross-subdomain via `COOKIE_DOMAIN`)
- Agent auth uses Bearer API tokens via Authorization header
- OAuth callback at `api.yourbro.ai/auth/google/callback`, redirects to `yourbro.ai/#/callback`

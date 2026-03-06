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
- **API**: Pushed via `.github/workflows/deploy.yml` (triggers on `api/`, `migrations/`, `deploy/` changes)
- **Frontend**: Pushed via `.github/workflows/web-deploy.yml` (triggers on `web/` changes)
- **Agent**: Released via `.github/workflows/release-skill.yml` (triggers on `v*` tags or manual dispatch). Builds cross-platform binaries (linux/amd64, darwin/arm64) and creates a GitHub Release with the skill package. **Agent changes do NOT autodeploy** — you must tag a release.

The API `Dockerfile` builds Go API. Frontend is NOT embedded — it deploys independently to Cloudflare R2.
`/p/{username}/{slug}` page routes are served by a static shell (`web/public/p/shell.html`) from R2 via Cloudflare Transform Rule. The shell stays on `yourbro.ai` (same origin for IndexedDB access) and makes cross-origin API calls to `api.yourbro.ai`.

### Pages architecture
- Pages are **directory-based**: each page is a folder at `/data/yourbro/pages/{slug}/` with `index.html` + assets (JS, CSS, etc.)
- Pages are multi-file by design. **NEVER suggest inlining assets** — the entire point is separate JS/CSS files served via Service Worker.
- A Service Worker (`web/public/p/page-sw.js`) caches the file bundle and serves sub-resources at `/p/assets/{slug}/*`
- The shell (`web/public/p/shell.html`) fetches the page bundle via E2E encrypted relay, caches files in the SW, then sets `iframe.src = "/p/assets/{slug}/index.html"` — the SW serves it. Relative URLs resolve naturally from the iframe's actual URL.
- `sandbox="allow-scripts allow-same-origin"` is required for the iframe to use the parent's Service Worker
- Cloudflare Transform Rules: the `/p/*` shell rule excludes `.js`, `.css`, `.json` extensions so the SW file and cached assets are served correctly (not rewritten to shell.html)

### SECURITY: E2E encryption for page content relay

The entire page bundle (HTML, JS, CSS — all files) is fetched in a single E2E encrypted relay request (`POST /api/relay/{agentId}`) using X25519 ECDH + HKDF-SHA256 + AES-256-GCM. The relay server is a blind pass-through — it cannot read page content.

The shell derives an AES key from the user's X25519 private key + agent's X25519 public key (exchanged during pairing), encrypts the relay request, and decrypts the encrypted response. The agent's relay router (`agent/internal/relay/router.go`) handles `encrypted: true` messages transparently.

Individual assets (JS, CSS, etc.) are **never fetched over the network**. After decryption, the shell sends all files to the Service Worker via in-browser `postMessage`. The SW caches them and serves them to the iframe locally. The `/p/assets/{slug}/*` URLs only exist between the SW cache and the iframe — they never hit the wire.

**NEVER fall back to plaintext relay. NEVER suggest plaintext relay as a fallback or degradation path.** If X25519 keys are missing, show an error and require re-pairing. All page content must be E2E encrypted through the relay or not delivered at all.

### Auth
- Browser auth uses httpOnly `yb_session` cookie (cross-subdomain via `COOKIE_DOMAIN`)
- Agent auth uses Bearer API tokens via Authorization header
- OAuth callback at `api.yourbro.ai/auth/google/callback`, redirects to `yourbro.ai/#/callback`

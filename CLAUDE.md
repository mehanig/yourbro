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

### Build skill package

To build the ClawdBot skill (SKILL.md only — binaries are hosted on R2 via GitHub Releases):
```bash
cd skill && bash scripts/build-skill.sh
```
Output: `skill/dist/yourbro/` — drag-and-drop into ClawHub to publish.

### Production deploy
- **API**: Pushed via `.github/workflows/deploy.yml` (triggers on `api/`, `migrations/`, `deploy/` changes)
- **Frontend**: Pushed via `.github/workflows/web-deploy.yml` (triggers on `web/` changes)
- **Agent**: Released via `.github/workflows/release-skill.yml` (triggers on `v*` tags or manual dispatch). Builds cross-platform binaries (linux/amd64, darwin/arm64) and creates a GitHub Release with the skill package. **Agent changes do NOT autodeploy** — you must tag a release.

The API `Dockerfile` builds Go API. Frontend is NOT embedded — it deploys independently to Cloudflare R2.
`/p/{username}/{slug}` page routes are served by a static shell (`web/public/p/shell.html`) from R2 via Cloudflare Transform Rule. The shell stays on `yourbro.ai` (same origin for IndexedDB access) and makes cross-origin API calls to `api.yourbro.ai`.

### Pages architecture
- Pages are **directory-based**: each page is a folder at `/data/yourbro/pages/{slug}/` with `index.html` + assets (JS, CSS, etc.)
- Pages are multi-file by design. **NEVER suggest inlining assets** — the entire point is separate files.
- **Two rendering paths** (chosen automatically based on Service Worker availability):
  - **SW path** (normal browsers): A Service Worker (`web/public/p/page-sw.js`) caches the file bundle and serves sub-resources at `/p/assets/{slug}/*`. The shell sets `iframe.src = "/p/assets/{slug}/index.html"` — the SW serves it. Relative URLs resolve naturally.
  - **Blob fallback** (in-app browsers like Telegram/Instagram on iOS): WKWebView doesn't support Service Workers. The shell creates blob URLs for all files, rewrites `src`/`href` attributes in the HTML via DOM parsing (`DOMParser` + `querySelectorAll`), and injects a fetch/XHR/property-setter override so JS-initiated requests also resolve from blob URLs. The iframe loads via `srcdoc`. **No JS/CSS source files are ever modified** — only HTML attributes are rewritten. The override also patches `HTMLImageElement.src`, `HTMLScriptElement.src`, etc. property setters for dynamic DOM manipulation.
- `sandbox="allow-scripts allow-same-origin"` is required on both paths — for SW access (SW path) and blob URL resolution (blob path)
- Cloudflare Transform Rules: the `/p/*` shell rule excludes `.js`, `.css`, `.json` extensions so the SW file and cached assets are served correctly (not rewritten to shell.html)
- Both rendering paths work for public and private pages — decryption (E2E relay) happens before `renderPage()`, so by the time it runs, `pageData.files` is plaintext regardless of source. In practice, the blob fallback primarily serves **public pages** shared via in-app browser links (Telegram, Instagram). Private pages require login + IndexedDB keys which in-app browsers don't have.
- Guard: `if (parts[1] === 'assets') return;` prevents recursive shell reload when SW doesn't intercept `/p/assets/*` requests
- **Debug mode**: append `?debug` to any page URL to see rendering path, SW state, blob map, and HTML preview as an on-screen overlay
- **Page Storage**: Iframed pages communicate with the agent via `postMessage` → shell.html → E2E encrypted relay → agent `/api/page-storage/*` endpoints. No crypto in the iframe — shell is the encryption proxy. Slug is hardcoded by the shell (iframe can't write to other pages' storage).

### SECURITY: E2E encryption for page content relay

The entire page bundle (HTML, JS, CSS — all files) is fetched in a single E2E encrypted relay request (`POST /api/relay/{agentId}`) using X25519 ECDH + HKDF-SHA256 + AES-256-GCM. The relay server is a blind pass-through — it cannot read page content.

The shell derives an AES key from the user's X25519 private key + agent's X25519 public key (exchanged during pairing), encrypts the relay request, and decrypts the encrypted response. The agent's relay router (`agent/internal/relay/router.go`) handles `encrypted: true` messages transparently.

Individual assets (JS, CSS, etc.) are **never fetched over the network**. After decryption, the shell sends all files to the Service Worker via in-browser `postMessage`. The SW caches them and serves them to the iframe locally. The `/p/assets/{slug}/*` URLs only exist between the SW cache and the iframe — they never hit the wire.

**Private pages must always use E2E encryption.** If X25519 keys are missing, show an error and require re-pairing. Never fall back to plaintext relay for private pages.

**Public pages** (opted in via `"public": true` in `page.json`) are served via plaintext relay through `GET /api/public-page/{username}/{slug}`. No auth or encryption required — anyone with the link can view. The agent checks the `public` flag before serving; non-public pages return 404. The API returns uniform 404 for all error cases (no info leakage). The shell branches on `localStorage.getItem('yb_logged_in')`: not set → try public endpoint; set → E2E encrypted path. (The `yb_session` cookie is httpOnly and invisible to JS.)

### Auth
- Browser auth uses httpOnly `yb_session` cookie (cross-subdomain via `COOKIE_DOMAIN`)
- Agent auth uses Bearer API tokens via Authorization header
- OAuth callback at `api.yourbro.ai/auth/google/callback`, redirects to `yourbro.ai/#/callback`

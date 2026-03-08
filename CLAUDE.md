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
- **Single rendering path (srcdoc + data URIs)**: The shell converts all page assets to data URIs, rewrites `src`/`href`/`poster` attributes in the HTML via DOM parsing (`DOMParser` + `querySelectorAll`), and injects a fetch/XHR/property-setter override so JS-initiated requests also resolve from data URIs. The iframe loads via `srcdoc`. **No JS/CSS source files are ever modified** — only HTML attributes are rewritten. The override also patches `HTMLImageElement.src`, `HTMLScriptElement.src`, etc. property setters for dynamic DOM manipulation.
- `sandbox="allow-scripts"` on the iframe (no `allow-same-origin`). This gives the iframe an **opaque origin**, preventing access to the parent shell's IndexedDB, cookies, and DOM. This is critical for security: page content is untrusted, and the viewer's X25519 private key lives in IndexedDB on the shell's origin.
- E2E decryption happens before `renderPage()`, so by the time it runs, `pageData.files` is plaintext. All visitors (paired and anonymous) generate X25519 keys stored in IndexedDB.
- **Debug mode**: append `?debug` to any page URL to see file count, data URI map, and HTML preview as an on-screen overlay
- **Page Storage**: Iframed pages communicate with the agent via `postMessage` (works cross-origin) -> shell.html -> E2E encrypted relay -> agent `/api/page-storage/*` endpoints. No crypto in the iframe. Shell is the encryption proxy. Slug is hardcoded by the shell (iframe can't write to other pages' storage).

### SECURITY: E2E encryption for page content relay

**All page traffic is E2E encrypted** — the server is zero-knowledge. The unified flow works for both public and private pages:

1. `GET /api/public-page/{username}/{slug}` — discovery only, returns `{ agent_uuid, x25519_public }` (CDN-cacheable, no content)
2. Shell generates/loads X25519 key pair from IndexedDB (all visitors, paired or anonymous)
3. Shell derives AES key via ECDH(viewer_priv, agent_pub) + HKDF-SHA256
4. `POST /api/public-page/{agent_uuid}/{slug}` — sends encrypted blob, API relays blindly to agent by UUID (no auth)
5. Agent decrypts, checks `key_id`: paired user (in `authorized_keys`) → any page; anonymous → `public:true` only
6. Agent encrypts response, viewer decrypts, renders

The agent publishes its X25519 pubkey during authenticated WS connect (`x25519_pub` query param). The API stores it in `agents.x25519_public_key`.

Individual assets (JS, CSS, etc.) are **never fetched over the network**. After decryption, the shell converts all files to data URIs and embeds them directly in the srcdoc HTML. No asset URLs hit the wire.

**"Decryption success = authentication."** If the agent can decrypt and the `key_id` matches a paired user in `authorized_keys`, that's proof of identity — no session cookie or content-token needed. Anonymous keys just get public pages.

**Page Storage** also goes through the same E2E encrypted relay — no cookies needed. The agent decides access based on `key_id`.

### Auth
- **All relay traffic is E2E encrypted**. There is no cleartext relay path. The agent rejects non-encrypted requests with 400. The API relay endpoint also enforces `encrypted`, `key_id`, and `payload`.
- **Dashboard**: httpOnly `yb_session` cookie (JWT, cross-subdomain via `COOKIE_DOMAIN`) for session management. All agent communication (page listing, pairing, deletion) uses E2E encrypted relay via `/api/relay/{agentId}`. The agent's X25519 public key is available in the `/api/agents` response and SSE stream (as `x25519_public`, base64url).
- **Page viewing**: no cookies. E2E encryption via X25519 keypairs in IndexedDB is the sole auth mechanism. Discovery + encrypted relay via `/api/public-page/` endpoints (no session required).
- **Agent → API**: Bearer API tokens via Authorization header on WebSocket connect
- **Relay ownership**: `POST /api/relay/{agent_id}` verifies `agent.UserID == session.UserID`. Only the agent's owner can relay to it. This protects pairing: a stolen pairing code is useless to other users since they can't reach the agent's `/api/pair` endpoint through the relay.
- **Pairing**: E2E encrypted using the agent's X25519 public key (available from the agent list before pairing). Pairing codes are one-time use, 5-minute expiry, max 5 attempts, constant-time comparison. Agent logs an E2E fingerprint for optional out-of-band verification.
- **key_id transport**: The relay router injects `key_id` into request context (not HTTP headers) after E2E decryption. Handlers read it via `handlers.KeyIDFromRequest(r)`. This prevents header spoofing.
- OAuth callback at `api.yourbro.ai/auth/google/callback`, redirects to `yourbro.ai/#/callback`

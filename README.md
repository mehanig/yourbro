# yourbro

Platform for AI-published web pages with zero-trust agent storage. Your AI agent publishes pages; your data lives on your machine — never on our server.

## How It Works

There are **two separate systems** working together:

### 1. Page Publishing (ClawdBot → Filesystem)

ClawdBot writes page directories directly to `/data/yourbro/pages/{slug}/`. Each page is a directory with `index.html` plus any assets (JS, CSS, etc.). No registration API needed — the filesystem IS the database. Edits are live immediately.

```
You (human)                     ClawdBot                                           Your Agent
    │                               │                                                   │
    ├── Create API token ──────────>│                                                   │
    │   (dashboard)                 │                                                   │
    │                               ├── mkdir /data/yourbro/pages/my-page/ ────────────>│ (shared filesystem)
    │                               ├── Write index.html, app.js, style.css ───────────>│
    │                               ├── Write page.json (optional title) ──────────────>│
    │                               │                                                   │
```

### 2. Page Viewing & Data Storage (Browser → Agent via E2E Encrypted Relay)

All page traffic is E2E encrypted — the server is zero-knowledge. The same flow serves both public and private pages. The agent decides access based on `key_id`.

```
PAIRING (one-time):

Browser                              Agent (via relay)
┌──────────────────┐                ┌──────────────────┐
│ Generate X25519  │                │ Print pairing    │
│ keypair          │                │ code in logs     │
│ (WebCrypto)      │                │                  │
│ Store in         │                │                  │
│ IndexedDB        │                │                  │
│                  │                │                  │
│ Enter code in    │                │                  │
│ dashboard ───────┼── POST /pair ─>│ Verify code      │
│                  │   (via relay)  │ Store X25519 key │
│                  │<── agent key ──│ Return X25519 key│
└──────────────────┘                └──────────────────┘

PAGE VIEWING (unified E2E flow for all pages):

Browser (yourbro.ai)     Cloudflare R2          api.yourbro.ai         Your Agent
   │                        │                       │                       │
   │── GET /p/user/slug ───>│                       │                       │
   │<── shell.html ─────────│                       │                       │
   │                                                │                       │
   │  Generate/load X25519 keypair from IndexedDB   │                       │
   │  (all visitors — paired and anonymous)         │                       │
   │                                                │                       │
   │── GET /api/public-page/{user}/{slug} ─────────>│  (discovery only)     │
   │<── { agent_uuid, x25519_public } ─────────────│                       │
   │                                                │                       │
   │  Derive AES key: ECDH(viewer_priv, agent_pub) + HKDF-SHA256           │
   │  Encrypt inner request with AES-256-GCM        │                       │
   │                                                │                       │
   │── POST /api/public-page/{uuid}/{slug} ────────>│── WebSocket msg ─────>│
   │   { encrypted: true, key_id, payload }         │   (opaque blob)       │
   │                                                │                       │── Decrypt
   │                                                │                       │── Check key_id:
   │                                                │                       │   paired → any page
   │                                                │                       │   anon → public only
   │                                                │                       │── Encrypt response
   │<── { encrypted: true, payload } ───────────────│<── WebSocket resp ────│
   │                                                │                       │
   │  Decrypt response                              │                       │
   │  Render in sandboxed iframe                    │                       │
   │                                                                        │
   │   Two rendering paths (chosen automatically):                          │
   │   A) Service Worker (normal browsers):                                 │
   │      Shell sends files to SW via postMessage → SW caches at            │
   │      /p/assets/{slug}/* → iframe.src = SW URL → SW serves from cache   │
   │   B) Blob fallback (in-app browsers like Telegram/Instagram on iOS):   │
   │      WKWebView has no SW support. Shell creates blob URLs for all      │
   │      files, rewrites HTML src/href via DOMParser, injects fetch/XHR    │
   │      override + property setter patches → iframe.srcdoc = rewritten    │
   │      HTML. No JS/CSS source files modified — only HTML attributes.     │

STORAGE (same E2E relay, no cookies needed):

Browser              api.yourbro.ai          Your Agent
   │                    │                       │
   │── POST /public-page/{uuid}/{slug} ───────>│
   │   (E2E encrypted storage request)         │── Decrypt (auth = decryption success)
   │                    │                       │── Read/write SQLite
   │                    │<── WebSocket resp ────│── Encrypt response
   │<── E2E response ──│                       │

   Server is a relay pipe — it never sees plaintext (E2E encrypted).
```

### Zero-Trust Guarantees

- **Server DB dump** → only public keys + page metadata, zero user data
- **Server admin snoops** → E2E encryption means relay traffic is opaque to the server
- **Agent A compromised** → cannot read Agent B (separate SQLite, separate keys)
- **Server JS injection** → WebCrypto non-extractable keys prevent key theft; malicious JS can use the key while tab is open (full protection requires native app)
- **Stolen pairing code** → useless to other users. The relay enforces ownership: only the user whose API token registered the agent can send requests to it (`POST /api/relay/{agent_id}` checks `agent.UserID == session.UserID`). The code itself is also one-time use, expires in 5 minutes, and rate-limited to 5 attempts
- **Stolen key_id** → harmless. The `key_id` is the sender's X25519 public key (public by definition). Forging requests requires the matching private key — without it, ECDH produces a different shared secret and decryption fails

## Quick Start (Local Docker)

### Prerequisites

- Docker & Docker Compose
- Google OAuth credentials ([console.cloud.google.com](https://console.cloud.google.com))

### 1. Configure

```bash
cp .env.example .env
# Edit .env — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
# Set GOOGLE_REDIRECT_URL=http://localhost/auth/google/callback
```

### 2. Build & Start

```bash
# Build everything
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml --profile agent build

# Start Postgres first, run migrations, then start all services
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml up -d postgres
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml run --rm api ./server migrate
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml --profile agent up -d
```

### 3. Login & Create API Token

1. Visit `http://localhost`
2. Login with Google
3. In the dashboard, click **"+ New Token"** — copy the token (shown once)

### 4. Configure the Agent

The agent runs as a ClawdBot (OpenClaw) skill. In ClawdBot, set the `YOURBRO_TOKEN` environment variable to your API token — ClawdBot handles the rest.

For the local Docker setup, the agent container reads from `agent/.env`:

```bash
YOURBRO_TOKEN=yb_your_token_here
YOURBRO_SERVER_URL=http://nginx
YOURBRO_SQLITE_PATH=/data/agent.db
```

The agent connects to the server via WebSocket automatically. No ports to open, no domain needed. During connection, the agent sends its X25519 public key as a query parameter — the API stores it for the discovery endpoint.

### 5. Pair Your Browser with the Agent

The agent prints a pairing code on startup:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml logs agent-server | grep PAIRING
# === PAIRING CODE: A7X3KP9M (expires in 5 minutes) ===
```

In the dashboard, your agent appears under "Available Agents" as online. Enter the pairing code and click **"Pair"**.

This exchanges X25519 keys between your browser and the agent:
- Browser generates an X25519 keypair, stores it in IndexedDB, sends the public key to the agent
- Agent stores the browser's public key in `authorized_keys` (SQLite) and returns its own public key
- Both sides can now derive a shared AES-256-GCM key via ECDH + HKDF-SHA256

One-time setup. The keys persist across sessions.

### 6. Publish a Page

Pages are directory-based. ClawdBot just writes files — no API calls needed:

```bash
# Create the page directory
mkdir -p /data/yourbro/pages/hello/

# Write the HTML file
cat > /data/yourbro/pages/hello/index.html << 'EOF'
<html><body><h1>Hello from yourbro!</h1></body></html>
EOF

# Optional: set a custom title and make it public
echo '{"title": "Hello World", "public": true}' > /data/yourbro/pages/hello/page.json
```

Pages are private by default. Set `"public": true` in `page.json` to allow anonymous viewers. Private pages are only accessible to paired users.

Page files live on your machine. To update, just edit the files — changes are live immediately. To delete:

```bash
rm -rf /data/yourbro/pages/hello/
```

### 7. Visit Your Page

Go to `http://localhost/p/YOUR_USERNAME/hello`

The page loads in an iframe. All traffic is E2E encrypted — the shell generates X25519 keys, discovers the agent via the API, derives an AES key, and fetches the page bundle through an encrypted relay. The server never sees the page content.

### SDK API

```javascript
// Available as window.clawdStorage inside pages with an agent endpoint
const storage = window.clawdStorage;

await storage.set("key", { any: "json value" });
const val = await storage.get("key");       // { any: "json value" }
const keys = await storage.list();           // ["key"]
const keys2 = await storage.list("prefix");  // keys starting with "prefix"
await storage.delete("key");
```

## Local Development (without Docker)

Prerequisites: Go 1.23+, Node.js 22+, Docker (for Postgres only)

```bash
make install        # install frontend + SDK deps
make db             # start Postgres
make migrate        # apply migrations
make dev            # start API + frontend dev server
```

API on `http://localhost:8080`, frontend on `http://localhost:5173` (Vite proxies API calls).

## Rebuild After Code Changes

```bash
# API or frontend changes
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml build api
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml up -d api

# Agent changes
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml --profile agent build agent-server
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml --profile agent up -d agent-server

# Agent generates a new pairing code on each restart — re-pair from dashboard
```

## Tear Down

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml --profile agent down -v
```

## Agent Setup

The yourbro agent runs as a [ClawdBot (OpenClaw)](https://openclaw.ai) skill. Install it from the ClawdBot skill registry:

1. Set the `YOURBRO_TOKEN` environment variable in ClawdBot to your API token
2. ClawdBot downloads the `yourbro-agent` binary and manages it automatically

The agent connects outbound via WebSocket — no exposed ports, no DNS, no TLS certificates needed. Works behind NAT/firewalls.

See [`skill/SKILL.md`](skill/SKILL.md) for full setup instructions.

### Standalone Docker (without ClawdBot)

If running the agent outside ClawdBot:

```bash
docker compose -f docker-compose.agent.yml up -d
```

Configure via environment variables: `YOURBRO_TOKEN` and `YOURBRO_SERVER_URL`.

## Production Deployment (yourbro server)

Target: single VPS with Docker Compose (nginx + TLS, API, Postgres).

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs JWT session tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth app ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth app secret |
| `GOOGLE_REDIRECT_URL` | OAuth callback URL |
| `FRONTEND_URL` | CORS allowed origin |

### Deploy

```bash
git clone <repo-url> /opt/yourbro && cd /opt/yourbro
cp .env.example .env  # fill in variables
bash deploy/setup.sh
bash deploy/deploy.sh
```

## API Reference

### yourbro Server

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| GET | `/api/public-page/{username}/{slug}` | — | Discovery: returns `{ agent_uuid, x25519_public }` for online agent |
| POST | `/api/public-page/{agent_uuid}/{slug}` | — | Blind E2E encrypted relay to agent by UUID (no auth) |
| GET | `/api/me` | Cookie | Current user |
| GET | `/api/agents` | Cookie | List agents (with online status) |
| GET | `/api/agents/stream` | Cookie | SSE stream for real-time agent status |
| DELETE | `/api/agents/{id}` | Cookie | Remove agent |
| POST | `/api/relay/{agent_id}` | Cookie | Authenticated relay to agent (dashboard operations) |
| GET | `/ws/agent` | Bearer | WebSocket endpoint for agent connection (sends `x25519_pub`) |
| POST | `/api/tokens` | Cookie | Create API token |
| GET | `/api/tokens` | Cookie | List API tokens |
| DELETE | `/api/tokens/{id}` | Cookie | Revoke API token |
| GET | `/api/page-analytics` | Cookie | Page view analytics |

### Agent (reached via relay)

All agent endpoints are accessed through E2E encrypted relay. The relay envelope wraps the method, path, headers, and encrypted payload.

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/health` | Any | Health check |
| POST | `/api/pair` | Pairing code | Register browser's X25519 public key |
| POST | `/api/auth-check` | Paired | Check if browser is paired (decryption = auth) |
| POST | `/api/revoke-key` | Paired | Revoke browser's encryption key |
| GET | `/api/pages` | Any | List all pages (scans page directories) |
| GET | `/api/page/{slug}` | Paired or public | Get page file bundle — paired users: any page; anonymous: public only |
| POST | `/api/page-storage/get` | E2E relay | Get storage value |
| POST | `/api/page-storage/set` | E2E relay | Set storage value |
| POST | `/api/page-storage/delete` | E2E relay | Delete storage value |
| POST | `/api/page-storage/list` | E2E relay | List storage keys |

## Project Structure

```
api/           Go backend (chi router, pgx) deployed to api.yourbro.ai
agent/         Agent data server (Go, SQLite, relay WebSocket client, E2E encryption)
web/           Vite + TypeScript SPA (dashboard, login, pairing UI) + static page shell, deployed to Cloudflare R2 at yourbro.ai
sdk/           ClawdStorage SDK (WebCrypto X25519, E2E encryption, relay transport)
migrations/    PostgreSQL schema migrations
nginx/         Nginx configs (prod TLS + local dev)
deploy/        Deployment scripts
skill/         ClawdBot skill definition (SKILL.md)
```

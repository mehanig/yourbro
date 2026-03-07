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

### 2. Page Viewing & Data Storage (Browser → Agent via Relay)

When someone visits `yourbro.ai/p/{username}/{slug}`, a static HTML shell served from Cloudflare R2 runs client-side — it stays on `yourbro.ai` (same origin as the dashboard) so IndexedDB keypairs are accessible. The shell fetches agent IDs from the API, loads the page from the agent via relay, and renders it in a sandboxed iframe with the SDK injected.

Storage operations use X25519 E2E encryption — if decryption succeeds, the sender is authenticated.

```
PAIRING (one-time):

Browser                              Agent (via relay)
┌──────────────────┐                ┌──────────────────┐
│ Generate X25519  │                │ Print pairing    │
│ keypair          │                │ code in logs     │
│ (WebCrypto)      │                │                  │
│ Enter code in    │                │                  │
│ dashboard ───────┼── POST /pair ─>│ Verify code      │
│                  │   (via relay)  │ Store X25519 key │
│                  │<── agent key ──│ Return X25519 key│
└──────────────────┘                └──────────────────┘

PAGE VIEWING:

Browser (yourbro.ai)     Cloudflare R2          api.yourbro.ai         Your Agent
   │                        │                       │                       │
   │── GET /p/user/slug ───>│                       │                       │
   │<── shell.html ─────────│                       │                       │
   │                                                │                       │
   │── GET /api/page-agents/user ──────────────────>│                       │
   │<── { agent_ids: [...] } ──────────────────────│                       │
   │── POST /api/relay/ID ────────────────────────>│── WebSocket msg ─────>│
   │<── page HTML ─────────────────────────────────│<── WebSocket resp ────│
   │                                                                        │
   │── Render in sandboxed iframe                                           │
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
   │                                                                        │
   │   Both paths work for public and private pages — E2E decryption        │
   │   happens before renderPage(), so pageData.files is always plaintext.  │
   │   In practice, blob fallback primarily serves public pages shared via  │
   │   in-app browsers (Telegram, Instagram). Private pages require login   │
   │   + IndexedDB keys which in-app browsers don't have.                   │

RUNTIME (every request, E2E encrypted):

Browser              api.yourbro.ai          Your Agent
   │                    │                       │
   │── POST /relay/ID ─>│── WebSocket msg ─────>│
   │   (E2E encrypted)  │   (opaque to server)  │── decrypt (auth = decryption success)
   │                    │                       │── process request
   │                    │<── WebSocket resp ────│
   │<── JSON data ──────│                       │

   yourbro server is a relay pipe — it never sees plaintext data (E2E encrypted).
```

### Zero-Trust Guarantees

- **Server DB dump** → only public keys + page metadata, zero user data
- **Server admin snoops** → E2E encryption means relay traffic is opaque to the server
- **Agent A compromised** → cannot read Agent B (separate SQLite, separate keys)
- **Server JS injection** → WebCrypto non-extractable keys prevent key theft; malicious JS can use the key while tab is open (full protection requires native app)

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

The agent connects to the server via WebSocket automatically. No ports to open, no domain needed.

### 5. Pair Your Browser with the Agent

The agent prints a pairing code on startup:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml logs agent-server | grep PAIRING
# === PAIRING CODE: A7X3KP9M (expires in 5 minutes) ===
```

In the dashboard, your agent appears in the "Paired Agents" section as online. Select it from the dropdown, enter the pairing code, and click **"Pair"**.

This generates an X25519 keypair in your browser and registers it with the agent for E2E encryption. One-time setup.

### 6. Publish a Page

Pages are directory-based. ClawdBot just writes files — no API calls needed:

```bash
# Create the page directory
mkdir -p /data/yourbro/pages/hello/

# Write the HTML file
cat > /data/yourbro/pages/hello/index.html << 'EOF'
<html><body><h1>Hello from yourbro!</h1></body></html>
EOF

# Optional: set a custom title
echo '{"title": "Hello World"}' > /data/yourbro/pages/hello/page.json
```

Page files live on your machine. To update, just edit the files — changes are live immediately. To delete:

```bash
rm -rf /data/yourbro/pages/hello/
```

### 7. Visit Your Page

Go to `http://localhost/p/YOUR_USERNAME/hello`

The page loads in an iframe. The SDK auto-initializes and communicates with the agent via E2E encrypted relay. Requests are encrypted with X25519 ECDH + AES-256-GCM and relayed through the WebSocket to your agent.

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
| GET | `/api/page-agents/{username}` | Bearer | Get agent IDs for a user (used by page shell) |
| GET | `/api/me` | Bearer | Current user |
| GET | `/api/agents` | Bearer | List agents (with online status) |
| GET | `/api/agents/stream` | Bearer | SSE stream for real-time agent status |
| DELETE | `/api/agents/{id}` | Bearer | Remove agent |
| POST | `/api/relay/{agent_id}` | Bearer | Relay request to agent via WebSocket |
| GET | `/ws/agent` | Bearer | WebSocket endpoint for agent connection |
| POST | `/api/tokens` | Bearer | Create API token |
| GET | `/api/tokens` | Bearer | List API tokens |
| DELETE | `/api/tokens/{id}` | Bearer | Revoke API token |

### Agent (reached via relay)

All agent endpoints are accessed through `POST /api/relay/{agent_id}`. The relay envelope wraps the method, path, and headers.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| POST | `/api/pair` | Pairing code | Register browser's X25519 public key |
| POST | `/api/auth-check` | E2E relay | Check if browser is paired |
| POST | `/api/revoke-key` | E2E relay | Revoke browser's encryption key |
| GET | `/api/pages` | — | List all pages (scans page directories) |
| GET | `/api/page/{slug}` | — | Get page file bundle (all files in directory) |
| GET | `/api/storage/{slug}/{key}` | E2E relay | Get storage value |
| PUT | `/api/storage/{slug}/{key}` | E2E relay | Set storage value |
| GET | `/api/storage/{slug}?prefix=` | E2E relay | List storage keys |
| DELETE | `/api/storage/{slug}/{key}` | E2E relay | Delete storage value |

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

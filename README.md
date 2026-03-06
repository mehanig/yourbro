# yourbro

Platform for AI-published web pages with zero-trust agent storage. Your AI agent publishes pages; your data lives on your machine — never on our server.

## How It Works

There are **two separate systems** working together:

### 1. Page Publishing (ClawdBot → Agent via Internal API)

ClawdBot writes HTML files directly to `/data/yourbro/pages/{slug}.html`, then registers them via the agent's internal API. The agent reads files from disk on every request, so edits are live immediately without re-registering.

```
You (human)                     ClawdBot                                           Your Agent
    │                               │                                                   │
    ├── Create API token ──────────>│                                                   │
    │   (dashboard)                 │                                                   │
    │                               ├── Write /data/yourbro/pages/my-page.html ────────>│ (shared filesystem)
    │                               ├── PUT localhost:19200/page/my-page ───────>│
    │                               │   X-YourBro-Internal-Key: <key>                   ├── Store path in SQLite
    │                               │                                                   │   (your machine)
```

### 2. Page Viewing & Data Storage (Browser → Agent via Relay)

When someone visits `yourbro.ai/p/{username}/{slug}`, a static HTML shell served from Cloudflare R2 runs client-side — it stays on `yourbro.ai` (same origin as the dashboard) so IndexedDB keypairs are accessible. The shell fetches agent IDs from the API, loads the page from the agent via relay, and renders it in a sandboxed iframe with the SDK injected.

Storage operations use Ed25519 keypairs with [RFC 9421 HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421) and X25519 E2E encryption.

```
PAIRING (one-time):

Browser                              Agent (via relay)
┌──────────────────┐                ┌──────────────────┐
│ Generate Ed25519 │                │ Print pairing    │
│ + X25519 keypairs│                │ code in logs     │
│ (WebCrypto)      │                │                  │
│ Enter code in    │                │                  │
│ dashboard ───────┼── POST /pair ─>│ Verify code      │
│                  │   (via relay)  │ Store public keys│
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
   │── Render in sandboxed iframe with SDK                                  │

RUNTIME (every request, E2E encrypted + signed per RFC 9421):

Browser              api.yourbro.ai          Your Agent
   │                    │                       │
   │── POST /relay/ID ─>│── WebSocket msg ─────>│
   │   (E2E encrypted)  │   (opaque to server)  │── decrypt + verify signature
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
SQLITE_PATH=/data/agent.db
```

The agent connects to the server via WebSocket automatically. No ports to open, no domain needed.

### 5. Pair Your Browser with the Agent

The agent prints a pairing code on startup:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml logs agent-server | grep PAIRING
# === PAIRING CODE: A7X3KP9M (expires in 5 minutes) ===
```

In the dashboard, your agent appears in the "Paired Agents" section as online. Select it from the dropdown, enter the pairing code, and click **"Pair"**.

This generates an Ed25519 keypair in your browser and registers it with the agent. One-time setup.

### 6. Publish a Page

Pages are managed via the agent's internal API. ClawdBot writes the HTML file and registers it:

```bash
# Read the internal API key (auto-generated on first startup)
KEY=$(cat /data/yourbro/internal.key)

# Write the HTML file
cat > /data/yourbro/pages/hello.html << 'EOF'
<html><body><h1>Hello from yourbro!</h1></body></html>
EOF

# Register the page
curl -X PUT localhost:19200/page/hello \
  -H "X-YourBro-Internal-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello World"}'
```

The page file lives on your machine. To update content, just edit the file — changes are live immediately. To update the title, re-register. To delete:

```bash
curl -X DELETE localhost:19200/page/hello \
  -H "X-YourBro-Internal-Key: $KEY"
```

### 7. Visit Your Page

Go to `http://localhost/p/YOUR_USERNAME/hello`

The page loads in an iframe. The SDK auto-initializes, receives your keypair from the parent page via `postMessage`, and signs every storage request. Requests are relayed through the WebSocket to your agent.

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
| POST | `/api/pair` | Pairing code | Register browser's public keys (Ed25519 + X25519) |
| GET | `/api/auth-check` | RFC 9421 sig | Check if browser's key is authorized |
| DELETE | `/api/keys` | RFC 9421 sig | Revoke browser's signing key |
| GET | `/api/pages` | — | List all pages |
| GET | `/api/page/{slug}` | — | Get page content (reads from disk) |
| GET | `/api/storage/{slug}/{key}` | RFC 9421 sig | Get storage value |
| PUT | `/api/storage/{slug}/{key}` | RFC 9421 sig | Set storage value |
| GET | `/api/storage/{slug}?prefix=` | RFC 9421 sig | List storage keys |
| DELETE | `/api/storage/{slug}/{key}` | RFC 9421 sig | Delete storage value |

### Agent Internal API (localhost only, port 19200)

ClawdBot manages pages via this API. It runs on `127.0.0.1:19200` — not exposed via relay, not accessible from the network. Auth via `X-YourBro-Internal-Key` header (key auto-generated at `/data/yourbro/internal.key`).

| Method | Path | Description |
|---|---|---|
| PUT | `/page/{slug}` | Register a page (file must exist at `/data/yourbro/pages/{slug}.html`) |
| DELETE | `/page/{slug}` | Unregister a page (file remains on disk) |

## Project Structure

```
api/           Go backend (chi router, pgx) deployed to api.yourbro.ai
agent/         Agent data server (Go, SQLite, relay WebSocket client, RFC 9421 auth)
web/           Vite + TypeScript SPA (dashboard, login, pairing UI) + static page shell, deployed to Cloudflare R2 at yourbro.ai
sdk/           ClawdStorage SDK (WebCrypto Ed25519, RFC 9421 signing, relay transport)
migrations/    PostgreSQL schema migrations
nginx/         Nginx configs (prod TLS + local dev)
deploy/        Deployment scripts
skill/         ClawdBot skill definition (SKILL.md)
```

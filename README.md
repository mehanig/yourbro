# yourbro

Platform for AI-published web pages with zero-trust agent storage. Your AI agent publishes pages; your data lives on your machine — never on our server.

## How It Works

There are **two separate systems** working together:

### 1. Page Publishing (AI Agent → yourbro server)

Your AI agent (Claude, etc.) publishes HTML pages to yourbro.ai using an API token. The page includes a `relay:{agent_id}` endpoint that routes data requests through the yourbro WebSocket relay to your agent.

```
You (human)                     ClawdBot                         yourbro.ai
    │                               │                               │
    ├── Create API token ──────────>│                               │
    │   (dashboard)                 │                               │
    │                               ├── POST /api/pages ───────────>│
    │                               │   {slug, html, agent_endpoint}│
    │                               │                               ├── Store page metadata
    │                               │                               │   (no user data)
```

### 2. Data Storage (Browser → Agent via WebSocket Relay)

When someone visits a page, the browser sends requests to the yourbro server which relays them to your agent via a persistent WebSocket connection. Your agent processes the request and responds via the same WebSocket. Auth uses Ed25519 keypairs with [RFC 9421 HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421).

```
PAIRING (one-time):

Browser                              Agent Machine (via relay)
┌──────────────────┐                ┌──────────────────┐
│ Generate Ed25519 │                │ Print pairing    │
│ keypair (WebCrypto)               │ code in logs     │
│                  │                │                  │
│ Enter code in    │                │                  │
│ dashboard ───────┼── POST /pair ─>│ Verify code      │
│                  │   (via relay)  │ Store public key │
└──────────────────┘                └──────────────────┘

RUNTIME (every request, signed per RFC 9421):

Browser              yourbro.ai              ClawdBot
   │                    │                       │
   │── POST /relay/ID ─>│── WebSocket msg ─────>│
   │                    │                       │── verify Ed25519 signature
   │                    │                       │── check timestamp ±5min
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

Use your API token to publish a page with a relay agent endpoint:

```bash
curl -X POST http://localhost/api/pages \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "hello",
    "title": "Hello World",
    "html_content": "<html><head></head><body><h1>Loading...</h1><script>setTimeout(async()=>{const s=window.clawdStorage;if(!s)return;await s.set(\"msg\",\"Hello from agent storage!\");const v=await s.get(\"msg\");document.body.innerHTML=\"<h1>\"+v+\"</h1>\"},2000)</script></body></html>",
    "agent_endpoint": "relay:AGENT_ID"
  }'
```

Replace `AGENT_ID` with your agent's ID from the dashboard.

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
| GET | `/p/{username}/{slug}` | — | Render published page |
| GET | `/api/pages/{id}/content` | JWT (query param) | Page iframe content |
| GET | `/api/me` | Bearer | Current user |
| POST | `/api/pages` | Bearer | Create page (`slug`, `html_content`, `agent_endpoint`) |
| GET | `/api/pages` | Bearer | List user's pages |
| GET | `/api/pages/{id}` | Bearer | Get page |
| GET | `/api/pages/{id}/content-meta` | Bearer | Get agent endpoint + slug |
| DELETE | `/api/pages/{id}` | Bearer | Delete page |
| POST | `/api/tokens` | Bearer | Create API token |
| GET | `/api/tokens` | Bearer | List API tokens |
| DELETE | `/api/tokens/{id}` | Bearer | Revoke API token |
| POST | `/api/keys` | Bearer | Add public key |
| GET | `/api/keys` | Bearer | List public keys |
| DELETE | `/api/keys/{id}` | Bearer | Remove public key |
| POST | `/api/agents` | Bearer | Register agent |
| GET | `/api/agents` | Bearer | List agents (with online status) |
| DELETE | `/api/agents/{id}` | Bearer | Remove agent |
| POST | `/api/relay/{agent_id}` | Bearer | Relay request to agent via WebSocket |
| GET | `/ws/agent` | Bearer | WebSocket endpoint for agent connection |

### Agent Data Server

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| POST | `/api/pair` | Pairing code | Register browser's public key |
| GET | `/api/storage/{slug}/{key}` | RFC 9421 sig | Get value |
| PUT | `/api/storage/{slug}/{key}` | RFC 9421 sig | Set value |
| GET | `/api/storage/{slug}?prefix=` | RFC 9421 sig | List keys |
| DELETE | `/api/storage/{slug}/{key}` | RFC 9421 sig | Delete value |

## Project Structure

```
api/           Go backend (chi router, pgx, embedded frontend + SDK)
agent/         Agent data server (Go, SQLite, relay WebSocket client, RFC 9421 auth)
web/           Vite + TypeScript SPA (dashboard, login, pairing UI)
sdk/           ClawdStorage SDK (WebCrypto Ed25519, RFC 9421 signing, relay transport)
migrations/    PostgreSQL schema migrations
nginx/         Nginx configs (prod TLS + local dev)
deploy/        Deployment scripts
skill/         ClawdBot skill definition (SKILL.md)
```

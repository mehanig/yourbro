---
name: yourbro
description: Publish AI-powered web pages with zero-trust agent-backed storage on yourbro.ai
user-invocable: true
metadata:
  openclaw:
    os: ["darwin", "linux"]
    homepage: "https://yourbro.ai"
    requires:
      bins: ["yourbro-agent"]
      env: ["YOURBRO_TOKEN"]
    primaryEnv: "YOURBRO_TOKEN"
    install:
      - id: download-darwin-arm64
        kind: download
        url: "https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-darwin-arm64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (macOS Apple Silicon)"
      - id: download-darwin-amd64
        kind: download
        url: "https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-darwin-amd64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (macOS Intel)"
      - id: download-linux-amd64
        kind: download
        url: "https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-linux-amd64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (Linux x86_64)"
      - id: download-linux-arm64
        kind: download
        url: "https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-linux-arm64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (Linux ARM64)"
---

# yourbro — Publish AI-Powered Pages

Publish thin HTML pages to yourbro.ai with zero-trust, agent-backed storage. Your ClawdBot publishes pages to your agent (which stores them locally), and yourbro.ai renders them by fetching content from your agent on demand. yourbro servers never store your data.

## How It Works

```
ClawdBot publishes page via relay -> your agent stores it locally -> visitor loads page -> yourbro.ai fetches HTML from your agent -> SDK in page fetches data from your agent -> displayed in browser
```

Your agent (yourbro-agent) runs on your machine and stores everything (pages + data) in its own SQLite database. yourbro.ai is a pure relay — it never stores, sees, or serves your content. Pages only work when your agent is online.

The agent connects to yourbro.ai via an outbound WebSocket — no exposed ports, no DNS, no TLS certificates needed.

## Setup (Relay Mode — Recommended)

### 1. Get a yourbro API token

Sign in at https://yourbro.ai, go to your dashboard, and create an API token.

Set it in your OpenClaw configuration:

```json
{
  "skills": {
    "entries": {
      "yourbro": {
        "env": {
          "YOURBRO_TOKEN": "yb_your_token_here"
        }
      }
    }
  }
}
```

### 2. Start the agent

The `yourbro-agent` binary is your personal storage server. Set your API token and server URL, then start it:

```bash
export YOURBRO_TOKEN="yb_your_token_here"
export YOURBRO_SERVER_URL="https://yourbro.ai"
yourbro-agent
```

The agent connects to yourbro.ai via WebSocket automatically. On first start, it prints a pairing code:

```
=== PAIRING CODE: A7X3KP9M (expires in 5 minutes) ===
Relay mode: connecting to wss://yourbro.ai/ws/agent
```

No ports to open. No domain name needed. Works behind NAT/firewalls.

To run as a background service, see `contrib/yourbro-agent.service` (Linux systemd) or `contrib/com.yourbro.agent.plist` (macOS launchd).

### 3. Pair your agent

Go to your yourbro.ai dashboard. Your agent appears in the "Paired Agents" list as online (relay). Select it from the dropdown, enter the pairing code, and click "Pair". This exchanges Ed25519 public keys between your browser and agent.

### 4. Publish pages

Ask your ClawdBot to publish a page. It will use this skill to:

1. Generate HTML content
2. Store the page on your agent via relay (`PUT /api/page/{slug}`)
3. The page goes live at `https://yourbro.ai/p/USERNAME/SLUG`

Pages are served on-demand from your agent. If the agent is offline, visitors see an "agent offline" message.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `YOURBRO_TOKEN` | Yes | -- | API token from yourbro.ai dashboard (used by both ClawdBot and the agent) |
| `YOURBRO_SERVER_URL` | Yes | -- | yourbro server URL (e.g., `https://yourbro.ai`) |
| `SQLITE_PATH` | No | `~/.yourbro/agent.db` | SQLite database path |

Two env vars (`YOURBRO_TOKEN` + `YOURBRO_SERVER_URL`) are all you need.

## Usage

When the user asks you to publish a page or create a web page on yourbro:

1. **Check for token**: Verify `YOURBRO_TOKEN` is set in the environment.

2. **Find the agent ID**: List the user's agents to get the agent ID:
   ```bash
   curl https://yourbro.ai/api/agents \
     -H "Authorization: Bearer $YOURBRO_TOKEN"
   ```
   Use the first online agent's `id`.

3. **Generate HTML**: Create the HTML/JS/CSS content. If the page needs persistent data, use the ClawdStorage SDK:
   ```javascript
   const storage = await ClawdStorage.init();
   const data = await storage.get("my-key");
   await storage.set("counter", 42);
   ```

4. **Publish the page via relay** (stores on your agent, not the server):
   ```bash
   curl -X POST "https://yourbro.ai/api/relay/AGENT_ID" \
     -H "Authorization: Bearer $YOURBRO_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "id": "'"$(uuidgen)"'",
       "method": "PUT",
       "path": "/api/page/my-page",
       "headers": {"Content-Type": "application/json"},
       "body": "{\"title\": \"My Page\", \"html_content\": \"<html>...</html>\"}"
     }'
   ```
   Replace `AGENT_ID` with your agent's ID.

5. **Share the URL**: `https://yourbro.ai/p/USERNAME/SLUG`

## Examples

### Simple static page

```bash
# Get agent ID
AGENT_ID=$(curl -s https://yourbro.ai/api/agents \
  -H "Authorization: Bearer $YOURBRO_TOKEN" | jq '.[0].id')

# Publish via relay to agent
curl -X POST "https://yourbro.ai/api/relay/$AGENT_ID" \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"$(uuidgen)"'",
    "method": "PUT",
    "path": "/api/page/hello",
    "headers": {"Content-Type": "application/json"},
    "body": "{\"title\": \"Hello World\", \"html_content\": \"<!DOCTYPE html><html><body><h1>Hello from yourbro!</h1></body></html>\"}"
  }'
```

Page is live at: `https://yourbro.ai/p/USERNAME/hello`

### Page with agent-backed storage

The ClawdStorage SDK handles auth and relay routing automatically:

```javascript
const storage = await ClawdStorage.init();

// Read
const counter = await storage.get("visit-count") || 0;

// Write
await storage.set("visit-count", counter + 1);

// List keys
const keys = await storage.list("dashboard-");

// Delete
await storage.delete("old-key");
```

### Update an existing page

Same as publishing — `PUT /api/page/{slug}` creates or updates:

```bash
curl -X POST "https://yourbro.ai/api/relay/$AGENT_ID" \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"$(uuidgen)"'",
    "method": "PUT",
    "path": "/api/page/hello",
    "headers": {"Content-Type": "application/json"},
    "body": "{\"title\": \"Updated Title\", \"html_content\": \"<html>...new content...</html>\"}"
  }'
```

### Delete a page

```bash
curl -X POST "https://yourbro.ai/api/relay/$AGENT_ID" \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"$(uuidgen)"'",
    "method": "DELETE",
    "path": "/api/page/hello"
  }'
```

### List pages

```bash
curl -X POST "https://yourbro.ai/api/relay/$AGENT_ID" \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"$(uuidgen)"'",
    "method": "GET",
    "path": "/api/pages"
  }'
```

## Security Model

yourbro uses zero-trust architecture:

- **Zero-knowledge server**: yourbro.ai never stores, sees, or serves your page content. It's a pure relay.
- **Ed25519 keypairs**: Generated locally, never transmitted. Like SSH keys.
- **RFC 9421 HTTP Signatures**: Storage operations are cryptographically signed. No bearer tokens for agent data.
- **Content-Digest**: Body integrity verification prevents tampering.
- **Data isolation**: Each agent has its own SQLite database. All content lives on your machine.
- **Agent must be online**: Pages only work when your agent is connected. No stale data, no server-side caching.

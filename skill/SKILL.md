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

Publish thin HTML pages to yourbro.ai with zero-trust, agent-backed storage. Your ClawdBot publishes pages, the yourbro SDK fetches data directly from your agent. yourbro servers never see your data.

## How It Works

```
ClawdBot publishes HTML page -> yourbro.ai renders it -> SDK in page fetches data from your agent -> displayed in browser
```

Your agent (yourbro-agent) runs on your machine and stores data in its own SQLite database. Pages published to yourbro.ai are thin HTML shells. The yourbro SDK embedded in those pages fetches data from your agent using Ed25519-signed requests.

The agent connects to yourbro.ai via an outbound WebSocket — no exposed ports, no DNS, no TLS certificates needed.

## Setup (Relay Mode — Recommended)

### 1. Get a yourbro API token

Sign in at https://yourbro.ai, go to your dashboard, and create an API token with scopes: `publish:pages`, `read:pages`.

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

The `yourbro-agent` binary is your personal data storage server. Set your API token and server URL, then start it:

```bash
export YB_API_TOKEN="yb_your_token_here"
export YB_SERVER_URL="https://yourbro.ai"
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
2. POST to yourbro.ai/api/pages with your token
3. The page goes live at `https://yourbro.ai/p/USERNAME/SLUG`

Pages with agent storage automatically use the relay — the SDK routes requests through yourbro.ai to your agent.

## Configuration

### Relay mode (recommended)

| Variable | Required | Default | Description |
|---|---|---|---|
| `YOURBRO_TOKEN` | Yes | -- | API token from yourbro.ai dashboard |
| `YB_API_TOKEN` | Yes | -- | Same token, used by the agent for WebSocket auth |
| `YB_SERVER_URL` | Yes | -- | yourbro server URL (e.g., `https://yourbro.ai`) |
| `YB_AGENT_NAME` | No | `relay-agent` | Name shown in dashboard |
| `SQLITE_PATH` | No | `~/.yourbro/agent.db` | SQLite database path |

Two env vars (`YB_API_TOKEN` + `YB_SERVER_URL`) are all you need. The agent auto-detects relay mode when `AGENT_PORT` and `AGENT_DOMAIN` are not set.

### Direct mode (advanced)

For users who want to expose their agent on a public port with TLS:

| Variable | Required | Default | Description |
|---|---|---|---|
| `YOURBRO_TOKEN` | Yes | -- | API token from yourbro.ai dashboard |
| `AGENT_PORT` | No | `9443` | Port the agent listens on |
| `AGENT_DOMAIN` | No | -- | Domain for automatic TLS via Let's Encrypt |
| `SQLITE_PATH` | No | `~/.yourbro/agent.db` | SQLite database path |
| `YB_SERVER_URL` | No | -- | yourbro server URL for heartbeat |
| `YB_AGENT_ENDPOINT` | No | -- | Public URL of this agent for heartbeat |

Set agent environment variables before starting `yourbro-agent`, or use the systemd/launchd service files in `contrib/`.

## Usage

When the user asks you to publish a page or create a web page on yourbro:

1. **Check for token**: Verify `YOURBRO_TOKEN` is set in the environment.

2. **Generate HTML**: Create the HTML/JS/CSS content. If the page needs persistent data, use the ClawdStorage SDK:
   ```javascript
   const storage = await ClawdStorage.init();
   const data = await storage.get("my-key");
   await storage.set("counter", 42);
   ```

3. **Publish the page**:
   ```bash
   curl -X POST https://yourbro.ai/api/pages \
     -H "Authorization: Bearer $YOURBRO_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "slug": "my-page",
       "title": "My Page",
       "html_content": "<html>...</html>",
       "agent_endpoint": "relay:AGENT_ID"
     }'
   ```
   Replace `AGENT_ID` with your agent's ID from the dashboard. For direct-mode agents, use the full endpoint URL instead (e.g., `https://agent.example.com:9443`).

4. **Share the URL**: `https://yourbro.ai/p/USERNAME/SLUG`

## Token Scopes

- `publish:pages` -- Create and update pages
- `read:pages` -- List and view pages
- `manage:keys` -- Manage public keys

## Headless/CLI Access

To access agent data without a browser (CLI, CI, Claude):

```bash
# Get agent endpoint for a page
curl https://yourbro.ai/api/pages/{id}/content-meta \
  -H "Authorization: Bearer $YOURBRO_TOKEN"

# Returns: {"agent_endpoint": "https://...", "slug": "my-page"}
```

Then sign requests with your Ed25519 keypair per RFC 9421.

## Security Model

yourbro uses zero-trust architecture:

- **Ed25519 keypairs**: Generated locally, never transmitted. Like SSH keys.
- **RFC 9421 HTTP Signatures**: Every request is cryptographically signed. No bearer tokens for agent communication.
- **Content-Digest**: Body integrity verification prevents tampering.
- **Zero server secrets**: No API tokens or private keys stored on yourbro.ai. You own your keys.
- **Data isolation**: Each agent has its own SQLite database. yourbro servers are untrusted brokers -- they route pages but never see your data.

## Examples

### Simple static page

```bash
curl -X POST https://yourbro.ai/api/pages \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "hello",
    "title": "Hello World",
    "html_content": "<!DOCTYPE html><html><body><h1>Hello from yourbro!</h1></body></html>"
  }'
```

### Page with agent-backed storage (relay mode)

Publish with `agent_endpoint` set to `relay:{agent_id}` (the dashboard shows the agent ID). The ClawdStorage SDK handles auth and relay routing automatically:

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

### Page with agent-backed storage (direct mode)

For direct-mode agents, use the agent's public endpoint URL:

```bash
curl -X POST https://yourbro.ai/api/pages \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-page",
    "title": "My Page",
    "html_content": "<html>...</html>",
    "agent_endpoint": "https://agent.example.com:9443"
  }'
```

The same ClawdStorage SDK works in both modes — mode detection is automatic.

### Update an existing page

```bash
curl -X PUT https://yourbro.ai/api/pages/{id} \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "html_content": "<html>...new content...</html>"
  }'
```

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

Your agent (yourbro-agent) runs on your machine and stores data in its own SQLite database. Pages published to yourbro.ai are thin HTML shells. The yourbro SDK embedded in those pages fetches data directly from your agent using Ed25519-signed requests.

## Setup

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

The `yourbro-agent` binary is your personal data storage server. Start it:

```bash
yourbro-agent
```

On first start, it prints a pairing code:

```
=== PAIRING CODE: A7X3KP9M (expires in 5 minutes) ===
```

To run as a background service, see `contrib/yourbro-agent.service` (Linux systemd) or `contrib/com.yourbro.agent.plist` (macOS launchd).

### 3. Pair your agent

Go to your yourbro.ai dashboard. Enter the agent endpoint URL (e.g., `https://your-domain:9443`) and the pairing code. This exchanges Ed25519 public keys between your browser and agent.

### 4. Publish pages

Ask your ClawdBot to publish a page. It will use this skill to:

1. Generate HTML content
2. POST to yourbro.ai/api/pages with your token
3. The page goes live at `https://yourbro.ai/p/USERNAME/SLUG`

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `YOURBRO_TOKEN` | Yes | -- | API token from yourbro.ai dashboard |
| `AGENT_PORT` | No | `9443` | Port the agent listens on |
| `AGENT_DOMAIN` | No | -- | Domain for automatic TLS (omit for local dev) |
| `SQLITE_PATH` | No | `~/.yourbro/agent.db` | SQLite database path |
| `YB_SERVER_URL` | No | -- | yourbro server URL for heartbeat (e.g., `https://yourbro.ai`) |
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
       "agent_endpoint": "https://agent.example.com:9443"
     }'
   ```

   Or use the helper script:
   ```bash
   ./scripts/publish.sh my-page "My Page" page.html
   ```

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

### Page with agent-backed storage

Publish with an `agent_endpoint`. The ClawdStorage SDK handles auth automatically:

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

```bash
curl -X PUT https://yourbro.ai/api/pages/{id} \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "html_content": "<html>...new content...</html>"
  }'
```

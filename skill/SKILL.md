---
name: yourbro
description: Publish AI-powered web pages with end-to-end encryption on yourbro.ai
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
        url: "https://yourbro.ai/releases/latest/yourbro-agent-darwin-arm64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (macOS Apple Silicon)"
      - id: download-darwin-amd64
        kind: download
        url: "https://yourbro.ai/releases/latest/yourbro-agent-darwin-amd64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (macOS Intel)"
      - id: download-linux-amd64
        kind: download
        url: "https://yourbro.ai/releases/latest/yourbro-agent-linux-amd64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (Linux x86_64)"
      - id: download-linux-arm64
        kind: download
        url: "https://yourbro.ai/releases/latest/yourbro-agent-linux-arm64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (Linux ARM64)"
---

# yourbro — Publish AI-Powered Pages

Publish multi-file web pages to yourbro.ai with end-to-end encryption. Your ClawdBot writes page directories to your agent (which stores them locally), and yourbro.ai renders them by fetching content from your agent via E2E encrypted relay. The server never sees your page content.

## How It Works

```
ClawdBot writes files to /data/yourbro/pages/{slug}/ -> page is live immediately -> visitor loads page -> browser fetches E2E encrypted bundle from agent via relay -> decrypts -> Service Worker caches assets -> rendered in sandboxed iframe
```

Your agent (yourbro-agent) runs on your machine and serves pages from local directories. yourbro.ai is a blind encrypted relay — it never stores, sees, or serves your content. All page bundles are encrypted with X25519 + AES-256-GCM before traversing the relay. Pages only work when your agent is online. Editing files on disk takes effect immediately.

The agent connects to yourbro.ai via an outbound WebSocket — no exposed ports, no DNS, no TLS certificates needed.

## Setup

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
export YOURBRO_SERVER_URL="https://api.yourbro.ai"
yourbro-agent
```

The agent connects to yourbro.ai via WebSocket automatically. On first start, it prints a pairing code:

```
=== PAIRING CODE: A7X3KP9M (expires in 5 minutes) ===
Relay mode: connecting to wss://api.yourbro.ai/ws/agent
```

No ports to open. No domain name needed. Works behind NAT/firewalls.

To run as a background service, see `contrib/yourbro-agent.service` (Linux systemd) or `contrib/com.yourbro.agent.plist` (macOS launchd).

### 3. Pair your agent

Go to your yourbro.ai dashboard. Your agent appears in the "Paired Agents" list as online (relay). Select it from the dropdown, enter the pairing code, and click "Pair". This exchanges X25519 encryption keys between your browser and agent for E2E encryption.

### 4. Publish pages

Ask your ClawdBot to publish a page. It will:

1. Create the page directory: `mkdir -p /data/yourbro/pages/{slug}/`
2. Write `index.html` (required) and any other files (JS, CSS, etc.)
3. Optionally write `page.json` with `{"title": "My Page", "public": false}` for a custom title and visibility control
4. The page goes live at `https://yourbro.ai/p/USERNAME/SLUG`

To update a page, just edit the files — changes are live immediately. To delete a page, remove the directory. No API calls needed.

### Page Visibility (Public vs Private)

Pages are **private by default**. Only the page owner (authenticated + paired browser) can view private pages via E2E encryption.

To make a page public (viewable by anyone with the link, no account needed):

```bash
echo '{"title": "My Portfolio", "public": true}' > /data/yourbro/pages/my-page/page.json
```

To make it private again:

```bash
echo '{"title": "My Portfolio", "public": false}' > /data/yourbro/pages/my-page/page.json
```

If `page.json` is missing or has no `"public"` field, the page defaults to **private**.

All pages (public and private) are served through E2E encryption — anonymous visitors generate ephemeral X25519 keys. Public pages do not have access to page storage. The agent must still be online to serve public pages.

## File Locations

| Path | Description |
|---|---|
| `yourbro-agent` | Agent binary (installed by OpenClaw to `~/.openclaw/tools/yourbro/`) |
| `/data/yourbro/pages/` | Page directories — each page is a folder with `index.html` + assets |
| `/data/yourbro/pages/{slug}/index.html` | Required entry point for each page |
| `/data/yourbro/pages/{slug}/page.json` | Optional metadata: `{"title": "Page Title", "public": false}`. Set `"public": true` to make the page viewable by anyone without authentication. |
| `~/.yourbro/agent.db` | SQLite database (agent identity, authorized keys, page storage) |

The agent binary is a single static executable. No runtime dependencies. OpenClaw downloads the correct platform binary (darwin/arm64, darwin/amd64, linux/amd64, linux/arm64) from GitHub Releases via the install URLs in the metadata above.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `YOURBRO_TOKEN` | Yes | -- | API token from yourbro.ai dashboard (used by both ClawdBot and the agent) |
| `YOURBRO_SERVER_URL` | Yes | -- | yourbro API server URL (e.g., `https://api.yourbro.ai`) |
| `YOURBRO_SQLITE_PATH` | No | `~/.yourbro/agent.db` | SQLite database path |

Two env vars (`YOURBRO_TOKEN` + `YOURBRO_SERVER_URL`) are all you need.

## Usage

When the user asks you to publish a page or create a web page on yourbro:

1. **Check for token**: Verify `YOURBRO_TOKEN` is set in the environment.

2. **Find the agent ID**: List the user's agents to get the agent ID:
   ```bash
   curl https://api.yourbro.ai/api/agents \
     -H "Authorization: Bearer $YOURBRO_TOKEN"
   ```
   Use the first online agent's `id`.

3. **Generate content**: Create HTML/JS/CSS files. Pages are directory-based — each page is a folder with `index.html` plus any assets.

4. **Write the page directory**:
   ```bash
   mkdir -p /data/yourbro/pages/my-page/

   cat > /data/yourbro/pages/my-page/index.html << 'EOF'
   <!DOCTYPE html>
   <html>
   <head>
       <link rel="stylesheet" href="style.css">
   </head>
   <body>
       <h1>My Page</h1>
       <script src="app.js"></script>
   </body>
   </html>
   EOF

   cat > /data/yourbro/pages/my-page/style.css << 'EOF'
   body { background: #0a0a0a; color: #fafafa; }
   EOF

   cat > /data/yourbro/pages/my-page/app.js << 'EOF'
   console.log('Hello from yourbro!');
   EOF

   # Optional: set a custom title (page is private by default)
   echo '{"title": "My Page"}' > /data/yourbro/pages/my-page/page.json

   # Or make it public so anyone with the link can view it:
   # echo '{"title": "My Page", "public": true}' > /data/yourbro/pages/my-page/page.json
   ```

5. **Share the URL**: `https://yourbro.ai/p/USERNAME/my-page`

## Examples

### Simple static page

```bash
mkdir -p /data/yourbro/pages/hello/
cat > /data/yourbro/pages/hello/index.html << 'EOF'
<!DOCTYPE html><html><body><h1>Hello from yourbro!</h1></body></html>
EOF
echo '{"title": "Hello World"}' > /data/yourbro/pages/hello/page.json
```

Page is live at: `https://yourbro.ai/p/USERNAME/hello`

### Multi-file page with JS and CSS

```bash
mkdir -p /data/yourbro/pages/dashboard/

cat > /data/yourbro/pages/dashboard/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body><div id="app"></div><script src="app.js"></script></body>
</html>
EOF

cat > /data/yourbro/pages/dashboard/style.css << 'EOF'
body { margin: 0; background: #111; color: #eee; font-family: system-ui; }
#app { padding: 20px; }
EOF

cat > /data/yourbro/pages/dashboard/app.js << 'EOF'
document.getElementById('app').innerHTML = '<h1>Dashboard</h1>';
EOF

echo '{"title": "Dashboard"}' > /data/yourbro/pages/dashboard/page.json
```

### Update an existing page

Just edit the files — changes are live immediately:

```bash
cat > /data/yourbro/pages/hello/index.html << 'EOF'
<!DOCTYPE html><html><body><h1>Updated content!</h1></body></html>
EOF
```

### Delete a page

```bash
rm -rf /data/yourbro/pages/hello/
```

### List pages (via relay)

```bash
curl -X POST "https://api.yourbro.ai/api/relay/$AGENT_ID" \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"$(uuidgen)"'",
    "method": "GET",
    "path": "/api/pages"
  }'
```

## Page Storage (data persistence)

Pages can store and retrieve data using `postMessage`. The shell handles E2E encryption — your page JS just sends plain messages. All data is stored in the agent's local SQLite database, scoped to the page slug.

### Set a value

```js
// In your page's JS (e.g., app.js)
var requestId = crypto.randomUUID();
window.parent.postMessage({
    type: 'yourbro-storage',
    action: 'set',
    key: 'user-score',
    value: { score: 42, level: 3 },
    requestId: requestId
}, '*');

window.addEventListener('message', function handler(event) {
    if (event.data.type === 'yourbro-storage-response' && event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        if (event.data.ok) console.log('Saved!');
    }
});
```

### Get a value

```js
var requestId = crypto.randomUUID();
window.parent.postMessage({
    type: 'yourbro-storage',
    action: 'get',
    key: 'user-score',
    requestId: requestId
}, '*');
// Response: { type: 'yourbro-storage-response', action: 'get', ok: true, data: { value: "..." } }
```

### List keys

```js
window.parent.postMessage({
    type: 'yourbro-storage',
    action: 'list',
    prefix: 'user-',
    requestId: crypto.randomUUID()
}, '*');
// Response: { type: 'yourbro-storage-response', action: 'list', ok: true, data: [{ key: "user-score", ... }] }
```

### Delete a key

```js
window.parent.postMessage({
    type: 'yourbro-storage',
    action: 'delete',
    key: 'user-score',
    requestId: crypto.randomUUID()
}, '*');
```

All storage is scoped to the page slug and E2E encrypted through the relay. Your agent must be online for storage operations to work.

## Security Model

yourbro uses zero-trust architecture:

- **E2E encrypted delivery**: All page traffic (public and private) is encrypted with X25519 ECDH + AES-256-GCM. The relay server passes through opaque ciphertext it cannot read. Anonymous visitors generate ephemeral X25519 keys; paired users use persistent keys stored in IndexedDB.
- **Zero-knowledge server**: yourbro.ai never stores, sees, or serves your page content. It's a blind relay.
- **X25519 keypairs**: Generated locally. Private keys never leave your device. Public keys are exchanged during pairing for E2E encryption.
- **Pairing security**: Pairing requests go through the authenticated relay (`POST /api/relay/{agent_id}`), which verifies the requesting user owns the agent. A stolen pairing code is useless to other users. Codes are one-time use, expire in 5 minutes, and are rate-limited to 5 attempts.
- **Data isolation**: Each agent has its own SQLite database. All content lives on your machine.
- **Agent must be online**: Pages only work when your agent is connected. No stale data, no server-side caching.

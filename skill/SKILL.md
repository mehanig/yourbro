# Yourbro Skills

## Publish Pages

Publish an HTML page to a user's yourbro.ai account with agent-backed storage.

## Usage

When the user asks you to publish a page or create a web page on yourbro:

1. **Get the API token**: Ask the user for their yourbro API token, or check if one is available in the environment as `YOURBRO_TOKEN`.

2. **Generate the HTML**: Create the HTML/JS/CSS content for the page. If the page needs data, the ClawdStorage SDK handles auth automatically via Ed25519 signatures.

3. **Publish the page** with an agent endpoint:
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

4. **Pair with the agent**: The agent prints a pairing code on startup. Use the dashboard UI or call the agent directly:
   ```bash
   curl -X POST https://agent.example.com:9443/api/pair \
     -H "Content-Type: application/json" \
     -d '{
       "pairing_code": "A7X3KP9M",
       "user_public_key": "<base64url-ed25519-public-key>",
       "username": "myuser"
     }'
   ```

5. **Share the URL**: The page is live at `https://yourbro.ai/p/USERNAME/SLUG`

## Token Scopes

Request these scopes when creating a token:
- `publish:pages` — Create/update pages
- `read:pages` — List and view pages
- `manage:keys` — Manage public keys

## Headless/CLI Access

To access agent data without a browser (CLI, CI, Claude):
```bash
# Get agent endpoint for a page
curl https://yourbro.ai/api/pages/{id}/content-meta \
  -H "Authorization: Bearer $YOURBRO_TOKEN"

# Returns: {"agent_endpoint": "https://...", "slug": "my-page"}
```

Then sign requests with your Ed25519 keypair per RFC 9421.

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

### Page with agent storage
Publish the page with an `agent_endpoint`. The page's JavaScript uses the ClawdStorage SDK — auth is automatic via WebCrypto Ed25519 signatures:
```javascript
const storage = await ClawdStorage.init();
const data = await storage.get("dashboard-data");
await storage.set("counter", 42);
```

## Auth Model

Yourbro uses a zero-trust model where the server is an untrusted broker:
- Browser generates Ed25519 keypair via WebCrypto (private key never leaves browser)
- User pairs with agent using a one-time pairing code
- Every request is signed per RFC 9421 HTTP Message Signatures
- Server cannot read agent data or forge auth

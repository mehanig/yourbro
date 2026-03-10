# Custom Domain Support

Serve yourbro pages from your own domain (e.g., `pages.alice.com/my-page`) instead of `yourbro.ai/p/alice/my-page`.

Custom domains are for **page viewing only** — the dashboard stays on `yourbro.ai`.

## User setup

### 1. Add domain in dashboard

Go to the **Custom Domains** section on `yourbro.ai` and enter your domain (e.g., `pages.example.com`).

### 2. Configure DNS

Add two DNS records at your registrar:

| Type  | Name                        | Value                              |
|-------|-----------------------------|------------------------------------|
| CNAME | `pages.example.com`         | `custom.yourbro.ai`               |
| TXT   | `_yourbro.pages.example.com`| `yb-verify=<token from dashboard>` |

The CNAME routes traffic to the yourbro VPS. The TXT record proves domain ownership.

### 3. Verify

Click **Verify** in the dashboard. The API checks:
- TXT record `_yourbro.{domain}` contains the expected `yb-verify=` token
- CNAME resolves to `custom.yourbro.ai` (best-effort; A records also work)

### 4. Set a default page (optional)

Once verified, set a **Default Page** slug. Visiting `pages.example.com/` serves that page. Without a default, the root path returns 404 — individual pages are still accessible at `pages.example.com/{slug}`.

### 5. TLS

A Let's Encrypt certificate is automatically provisioned on the first HTTPS request to your domain. No manual setup needed.

## URL structure

| Context       | URL format                         |
|---------------|------------------------------------|
| yourbro.ai    | `yourbro.ai/p/{username}/{slug}`   |
| Custom domain | `pages.example.com/{slug}`         |
| Custom root   | `pages.example.com/` (default slug)|

On custom domains, the username is implicit — resolved from the domain ownership in the database.

## How it works

### Request flow

```
Browser → pages.example.com
       ↓
   DNS CNAME → custom.yourbro.ai (VPS IP)
       ↓
   nginx (port 443, SNI routing)
     ├─ yourbro.ai → nginx TLS termination (port 8444) → api:8080
     └─ anything else → Go autocert TLS (port 8443)
       ↓
   Go server: look up host in custom_domains table
       ↓
   Serve shell.html with username + API URL templated in
       ↓
   shell.html (in browser): fetch page via E2E encrypted relay
     → GET https://api.yourbro.ai/api/public-page/{username}/{slug}
     → POST encrypted relay to agent
     → Decrypt + render in sandboxed iframe
```

### Why this is simple

Page viewing is **fully cookie-free and E2E encrypted**. The shell.html just needs to reach `api.yourbro.ai` for discovery + relay. No session auth, no cookie sharing, no complex cross-origin flows. Custom domains get permissive CORS on the public-page API endpoints (`Access-Control-Allow-Origin: *`, no credentials).

### Shell templating

`shell.html` contains two placeholders:

```javascript
var API = '/*YOURBRO_API_URL*/';
var CUSTOM_DOMAIN_USER = '/*YOURBRO_CUSTOM_USER*/';
```

- **On yourbro.ai (R2)**: placeholders stay as literal strings. The shell detects unreplaced `/*` prefixes and falls back to the original logic (infer API URL from hostname, parse `/p/{username}/{slug}`).
- **On custom domains (Go server)**: the server does `strings.Replace` to inject `https://api.yourbro.ai` and the username before serving. The shell parses `/{slug}` from the path.

### TLS auto-provisioning

Uses `golang.org/x/crypto/acme/autocert`:

- `HostPolicy` checks the `custom_domains` table — only verified domains get certificates
- Cert cache: `/data/autocert-cache/` (Docker volume `autocert-cache`)
- ACME HTTP-01 challenges: nginx catches `/.well-known/acme-challenge/` on port 80 and proxies to Go on port 8080
- Go listens on port 8443 for custom domain HTTPS traffic

### nginx SNI routing

Port 443 uses a `stream` block with `ssl_preread` to inspect the SNI hostname before TLS termination:

- `yourbro.ai` → nginx handles TLS (port 8444), proxies to api:8080
- Everything else → forwarded raw to Go's autocert listener (api:8443)

This lets nginx keep its existing certs for `yourbro.ai` while Go manages certs for custom domains independently.

### CORS split

The API uses two CORS configurations:

| Routes                  | CORS policy                                           |
|-------------------------|-------------------------------------------------------|
| `/api/public-page/*`    | `Access-Control-Allow-Origin: *`, no credentials      |
| Everything else (`/api/*`, `/auth/*`) | Origin-locked to `FRONTEND_URL`, with credentials |

Public-page routes are safe to open because they're cookie-free and E2E encrypted. The agent decides access based on the `key_id` in the encrypted payload.

## Architecture

### Database

```sql
CREATE TABLE custom_domains (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain TEXT NOT NULL UNIQUE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_token TEXT NOT NULL,
    tls_provisioned BOOLEAN NOT NULL DEFAULT FALSE,
    default_slug TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);
```

### API endpoints (authenticated)

| Method | Path                            | Description                     |
|--------|---------------------------------|---------------------------------|
| POST   | `/api/custom-domains`           | Add domain, get DNS instructions|
| GET    | `/api/custom-domains`           | List user's domains             |
| POST   | `/api/custom-domains/{id}/verify` | Trigger DNS verification      |
| PUT    | `/api/custom-domains/{id}`      | Update settings (default_slug)  |
| DELETE | `/api/custom-domains/{id}`      | Remove domain                   |

### Files

| File | Role |
|------|------|
| `migrations/014_create_custom_domains.sql` | Schema |
| `api/internal/models/models.go` | `CustomDomain` struct |
| `api/internal/storage/postgres.go` | DB methods |
| `api/internal/handlers/custom_domains.go` | CRUD + DNS verification |
| `api/cmd/server/main.go` | Routes, CORS split, autocert, shell serving |
| `api/cmd/server/shell.html` | Embedded copy (Dockerfile copies from `web/`) |
| `web/public/p/shell.html` | Source of truth, with template placeholders |
| `nginx/nginx.conf` | SNI stream routing |
| `docker-compose.prod.yml` | Port 8443 + autocert volume |
| `web/src/lib/api.ts` | Frontend API client |
| `web/src/components/CustomDomainsSection.tsx` | Dashboard UI |
| `web/src/pages/DashboardPage.tsx` | Wires in the section |

## Security considerations

- **No cookie exposure**: custom domains never receive `yb_session` cookies (scoped to `yourbro.ai`). Page viewing doesn't use cookies at all.
- **E2E encryption unchanged**: the same X25519 ECDH + AES-GCM flow works regardless of which origin serves the shell. The agent validates `key_id`, not the origin.
- **Domain verification**: TXT record verification prevents anyone from claiming a domain they don't control. Autocert only provisions certs for verified domains.
- **Sandboxed iframe**: pages render in `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` (no `allow-same-origin`) — same as on yourbro.ai. The iframe gets an opaque origin on custom domains too.

## One-time infrastructure setup

Add a DNS A record for `custom.yourbro.ai` pointing to the VPS IP. This is the CNAME target that users point their domains to.

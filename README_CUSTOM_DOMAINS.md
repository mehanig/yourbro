# Custom Domain Support

Serve yourbro pages from your own domain (e.g., `pages.alice.com/my-page`) instead of `yourbro.ai/p/alice/my-page`.

Custom domains are for **page viewing only** -- the dashboard stays on `yourbro.ai`.

## User setup

### 1. Add domain in dashboard

Go to the **Custom Domains** section on `yourbro.ai` and enter your domain (e.g., `pages.example.com`).

### 2. Configure DNS

Add two DNS records at your registrar:

| Type  | Name                        | Value                              |
|-------|-----------------------------|------------------------------------|
| CNAME | `pages.example.com`         | `custom.yourbro.ai`               |
| TXT   | `_yourbro.pages.example.com`| `yb-verify=<token from dashboard>` |

The CNAME routes traffic through Cloudflare to the yourbro origin. The TXT record proves domain ownership.

### 3. Verify

Click **Verify** in the dashboard. The API checks:
- TXT record `_yourbro.{domain}` contains the expected `yb-verify=` token
- CNAME resolves to `custom.yourbro.ai` (best-effort; A records also work)

On success, the domain is registered with Cloudflare Custom Hostnames for automatic TLS provisioning.

### 4. Set a default page (optional)

Once verified, set a **Default Page** slug. Visiting `pages.example.com/` serves that page. Without a default, the root path returns 404 -- individual pages are still accessible at `pages.example.com/{slug}`.

### 5. TLS

TLS certificates are provisioned automatically by Cloudflare after verification. No manual setup needed.

## URL structure

| Context       | URL format                         |
|---------------|------------------------------------|
| yourbro.ai    | `yourbro.ai/p/{username}/{slug}`   |
| Custom domain | `pages.example.com/{slug}`         |
| Custom root   | `pages.example.com/` (default slug)|

On custom domains, the username is implicit -- resolved from the domain ownership in the database.

## How it works

### Request flow

```
Browser -> pages.example.com
       |
   DNS CNAME -> custom.yourbro.ai (Cloudflare-proxied)
       |
   Cloudflare: TLS termination + proxy to origin
       |
   nginx (origin): proxy to api:8080, preserving Host header
       |
   Go server: Host != api.yourbro.ai? -> custom domain handler
       |
   Look up host in custom_domains table -> get username
       |
   Serve shell.html with username + API URL templated in
       |
   shell.html (in browser): fetch page via E2E encrypted relay
     -> GET https://api.yourbro.ai/api/public-page/{username}/{slug}
     -> POST encrypted relay to agent
     -> Decrypt + render in sandboxed iframe
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
- **On custom domains (Go server)**: values are injected via `json.Marshal` (safe JS string encoding) before serving. The shell parses `/{slug}` from the path.

### TLS via Cloudflare for SaaS

Custom domain TLS is handled by Cloudflare Custom Hostnames (Cloudflare for SaaS):

- `custom.yourbro.ai` is a Cloudflare-proxied A record (orange cloud) pointing to the VPS
- Users CNAME their domains to `custom.yourbro.ai`
- After DNS verification, the API registers the hostname with Cloudflare via the Custom Hostnames API
- Cloudflare provisions a TLS certificate and proxies traffic to the origin
- The VPS IP stays hidden behind Cloudflare

No autocert, no exposed ports, no SNI routing needed.

### Host-based routing in Go

The Go server uses middleware to inspect the `Host` header:
- If `Host` matches `API_HOST` (e.g., `api.yourbro.ai`), `localhost`, or `127.0.0.1`: normal API routing
- Otherwise: custom domain handler (DB lookup, shell.html serving)

nginx passes through the `Host` header from Cloudflare, so Go sees the original custom domain.

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
    cf_hostname_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);
```

### API endpoints (authenticated)

| Method | Path                            | Description                     |
|--------|---------------------------------|---------------------------------|
| POST   | `/api/custom-domains`           | Add domain, get DNS instructions|
| GET    | `/api/custom-domains`           | List user's domains             |
| POST   | `/api/custom-domains/{id}/verify` | DNS verification + Cloudflare registration |
| PUT    | `/api/custom-domains/{id}`      | Update settings (default_slug)  |
| DELETE | `/api/custom-domains/{id}`      | Remove domain + Cloudflare cleanup |

### Files

| File | Role |
|------|------|
| `migrations/014_create_custom_domains.sql` | Schema |
| `migrations/015_add_cf_hostname_id.sql` | Cloudflare hostname ID column |
| `api/internal/models/models.go` | `CustomDomain` struct |
| `api/internal/storage/postgres.go` | DB methods |
| `api/internal/handlers/custom_domains.go` | CRUD + DNS verification + Cloudflare API |
| `api/internal/cloudflare/custom_hostnames.go` | Cloudflare Custom Hostnames API client |
| `api/cmd/server/main.go` | Routes, CORS split, host-based routing, shell serving |
| `api/cmd/server/shell.html` | Embedded copy (Dockerfile copies from `web/`) |
| `web/public/p/shell.html` | Source of truth, with template placeholders |
| `nginx/nginx.conf` | Simple origin proxy (no SNI routing) |
| `web/src/lib/api.ts` | Frontend API client |
| `web/src/components/CustomDomainsSection.tsx` | Dashboard UI |
| `web/src/pages/DashboardPage.tsx` | Wires in the section |

## Security considerations

- **No cookie exposure**: custom domains never receive `yb_session` cookies (scoped to `yourbro.ai`). Page viewing doesn't use cookies at all.
- **E2E encryption unchanged**: the same X25519 ECDH + AES-GCM flow works regardless of which origin serves the shell. The agent validates `key_id`, not the origin.
- **Domain verification**: TXT record verification prevents anyone from claiming a domain they don't control. Cloudflare only provisions certs for domains registered via the API.
- **IP hidden**: the VPS IP is not exposed. `custom.yourbro.ai` is proxied through Cloudflare (orange cloud).
- **Sandboxed iframe**: pages render in `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` (no `allow-same-origin`) -- same as on yourbro.ai.
- **Safe templating**: username and API URL are injected into shell.html via `json.Marshal`, preventing XSS from special characters.

## One-time infrastructure setup

1. Enable **Cloudflare for SaaS** on the `yourbro.ai` zone
2. Add a Cloudflare-proxied A record: `custom.yourbro.ai` -> VPS IP (orange cloud)
3. Set `custom.yourbro.ai` as the fallback origin for Custom Hostnames
4. Create a CF API Token with `SSL and Certificates: Edit` + `Custom Hostnames: Edit` permissions
5. Add `CF_ZONE_ID` and `CF_API_TOKEN` as GitHub Actions secrets

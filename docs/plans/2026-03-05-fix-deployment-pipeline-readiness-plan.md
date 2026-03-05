---
title: "fix: Deployment pipeline readiness — R2 static site + route configuration"
type: fix
status: completed
date: 2026-03-05
---

# Deployment Pipeline Readiness — R2 Static Site

## Overview

Switch the frontend deployment from Cloudflare Workers to **R2 static site with Transform Rules** (same pattern as hunder-app). Configure Cloudflare routing so `/p/*` page requests reach the API server on the VPS.

**Current state:**
- Frontend deploys to Cloudflare Workers via `wrangler-action` — wrong approach, switching to R2
- API deploys to Hetzner VPS via Docker Compose — this works
- `/p/{username}/{slug}` page routes are served by the API server — need Cloudflare rule to bridge domains
- No post-deploy verification in either pipeline

**Target state:**
- `yourbro.ai` → R2 static site (versioned builds, Transform Rules for SPA routing)
- `api.yourbro.ai` → Hetzner VPS (Go API, WebSocket relay, page rendering)
- `yourbro.ai/p/*` → redirects to `api.yourbro.ai/p/*` via Cloudflare Redirect Rule

## Technical Approach

### Phase 1: Create R2 Bucket and Credentials

**Manual steps in Cloudflare dashboard:**

- [ ] Create R2 bucket: `yourbro-web`
- [ ] Enable R2 public access with custom domain `yourbro.ai`
- [ ] Create R2 API token with read/write access to the bucket
- [ ] Note `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- [ ] Add GitHub Secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`

### Phase 2: Rewrite Frontend Pipeline for R2

**File:** `.github/workflows/web-deploy.yml`

Replace the current Workers-based deploy with R2 + Transform Rules (adapted from hunder-app):

```yaml
name: Deploy Frontend to R2

on:
  push:
    branches: [main]
    paths: ['web/**', 'sdk/**']
  workflow_dispatch:

env:
  BUILD_PATH: build-${{ github.run_number }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Build SDK
        run: cd sdk && npm install --ignore-scripts && npm rebuild esbuild && npm run build

      - name: Build Frontend
        run: cd web && npm ci && npm run build
        env:
          VITE_API_URL: https://api.yourbro.ai

      - name: Deploy to R2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        run: |
          aws s3 sync web/dist s3://yourbro-web/${{ env.BUILD_PATH }} \
            --endpoint-url https://${{ secrets.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com \
            --region auto

      - name: Update Cloudflare Transform Rules
        env:
          CF_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CF_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}
        run: |
          curl -sf -X PUT "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_request_transform/entrypoint" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data '{
              "rules": [
                {
                  "expression": "(starts_with(http.request.uri.path, \"/assets/\"))",
                  "description": "Serve Vite Assets",
                  "action": "rewrite",
                  "action_parameters": {
                    "uri": {
                      "path": {
                        "expression": "concat(\"/${{ env.BUILD_PATH }}\", http.request.uri.path)"
                      }
                    }
                  }
                },
                {
                  "expression": "(ends_with(http.request.uri.path, \".png\") or ends_with(http.request.uri.path, \".svg\") or ends_with(http.request.uri.path, \".ico\") or ends_with(http.request.uri.path, \".jpg\") or ends_with(http.request.uri.path, \".jpeg\") or ends_with(http.request.uri.path, \".gif\") or ends_with(http.request.uri.path, \".webp\") or ends_with(http.request.uri.path, \".webmanifest\") or ends_with(http.request.uri.path, \".xml\") or ends_with(http.request.uri.path, \".js\") or ends_with(http.request.uri.path, \".css\"))",
                  "description": "Serve Static Files",
                  "action": "rewrite",
                  "action_parameters": {
                    "uri": {
                      "path": {
                        "expression": "concat(\"/${{ env.BUILD_PATH }}\", http.request.uri.path)"
                      }
                    }
                  }
                },
                {
                  "expression": "(not starts_with(http.request.uri.path, \"/assets/\") and not starts_with(http.request.uri.path, \"/p/\") and not ends_with(http.request.uri.path, \".png\") and not ends_with(http.request.uri.path, \".svg\") and not ends_with(http.request.uri.path, \".ico\") and not ends_with(http.request.uri.path, \".jpg\") and not ends_with(http.request.uri.path, \".jpeg\") and not ends_with(http.request.uri.path, \".gif\") and not ends_with(http.request.uri.path, \".webp\") and not ends_with(http.request.uri.path, \".webmanifest\") and not ends_with(http.request.uri.path, \".xml\") and not ends_with(http.request.uri.path, \".js\") and not ends_with(http.request.uri.path, \".css\"))",
                  "description": "SPA Routing (exclude /p/ pages)",
                  "action": "rewrite",
                  "action_parameters": {
                    "uri": {
                      "path": {
                        "value": "/${{ env.BUILD_PATH }}/index.html"
                      }
                    }
                  }
                }
              ]
            }'

      - name: Print deployment info
        run: |
          echo "Deployed to: yourbro-web/${{ env.BUILD_PATH }}/"
          echo "Transform rules updated to point to ${{ env.BUILD_PATH }}"
```

**Key differences from hunder-app:**
- SDK build step before frontend build
- `VITE_API_URL` env var for cross-origin API calls
- SPA fallback rule excludes `/p/*` (page routes served by API server)
- Added `.js` and `.css` to static file extensions (hunder-app missed these, Vite generates hashed `.js`/`.css` files)

**Files to modify:**
- [x] `.github/workflows/web-deploy.yml` — rewrite for R2 deploy

### Phase 3: Remove Workers Configuration

**File:** `web/wrangler.toml` — **DELETE this file**

Workers are no longer used. The `wrangler.toml` is replaced by the R2 + Transform Rules approach.

- [x] Delete `web/wrangler.toml`

### Phase 4: Cloudflare Redirect Rule for `/p/*` Pages

The `/p/{username}/{slug}` route is server-rendered by the Go API. With R2 serving `yourbro.ai`, these paths need to reach the VPS.

**Manual step in Cloudflare dashboard → Rules → Redirect Rules:**

Create a redirect rule:
- **Expression:** `starts_with(http.request.uri.path, "/p/")`
- **Action:** Dynamic redirect
- **Target:** `concat("https://api.yourbro.ai", http.request.uri.path)`
- **Status code:** 301

This redirects `yourbro.ai/p/mehanig/hello` → `api.yourbro.ai/p/mehanig/hello`.

The `yb_session` cookie has `Domain=yourbro.ai` which covers `api.yourbro.ai`, so the session cookie is sent to the API server automatically. Auth works.

**Note on rule ordering:** Cloudflare Redirect Rules execute before Transform Rules, so `/p/*` requests are redirected before the Transform Rule SPA fallback could catch them. The `not starts_with("/p/")` exclusion in the SPA rule is defense-in-depth.

- [ ] Create Cloudflare Redirect Rule for `/p/*` → `api.yourbro.ai/p/*`

### Phase 5: DNS Configuration

**In Cloudflare dashboard:**

- [ ] `yourbro.ai` — should point to R2 (Cloudflare manages this when R2 custom domain is enabled)
- [ ] `api.yourbro.ai` — A record pointing to Hetzner VPS IP, proxied (orange cloud)
- [ ] Verify both records exist and are proxied

### Phase 6: Add Post-Deploy Verification

#### Frontend pipeline

Add to `.github/workflows/web-deploy.yml` after Transform Rules update:

```yaml
      - name: Verify deployment
        run: |
          sleep 10
          STATUS=$(curl -s -o /dev/null -w '%{http_code}' https://yourbro.ai/)
          if [ "$STATUS" != "200" ]; then
            echo "ERROR: Frontend returned $STATUS"
            exit 1
          fi
          echo "Frontend deployment verified (HTTP $STATUS)"
```

#### API pipeline

Add to `.github/workflows/deploy.yml` at end of SSH script:

```bash
            # Verify deployment
            sleep 5
            if curl -sf https://api.yourbro.ai/health > /dev/null; then
              echo "==> Health check passed"
            else
              echo "==> WARNING: Health check failed"
              docker compose logs --tail=20
            fi
```

- [x] Add verification step to `web-deploy.yml`
- [x] Add health check to `deploy.yml`

### Phase 7: Verify VPS `.env` Configuration

The deploy script should set these values on first deploy:

```env
FRONTEND_URL=https://yourbro.ai
COOKIE_DOMAIN=yourbro.ai
GOOGLE_REDIRECT_URL=https://api.yourbro.ai/auth/google/callback
DOMAIN=yourbro.ai
```

**Manual verification:**
- [ ] SSH to VPS, check `/opt/yourbro/.env`
- [ ] Verify `GOOGLE_REDIRECT_URL` uses `api.yourbro.ai`

### Phase 8: Google OAuth Redirect URI

- [ ] Verify `https://api.yourbro.ai/auth/google/callback` is in Google Cloud Console authorized redirect URIs
- [ ] Remove old URI if present (after confirming new one works)

## R2 vs Workers — Why R2

| Aspect | Workers | R2 + Transform Rules |
|--------|---------|---------------------|
| SPA routing | Native (`not_found_handling`) | Via Transform Rules |
| Cache busting | Atomic deploy | Versioned builds (`build-{N}`) |
| `/p/*` routing | Worker route exclusion | Redirect Rule (simpler) |
| Consistency with hunder-app | Different pattern | Same pattern |
| CDN caching | Workers serve from edge | R2 serves from edge with caching |
| Deployment model | `wrangler deploy` | `aws s3 sync` + API call |

User preference: R2 for consistency with hunder-app.

## Files to Modify

| File | Change |
|------|--------|
| `.github/workflows/web-deploy.yml` | Rewrite: R2 deploy + Transform Rules |
| `.github/workflows/deploy.yml` | Add post-deploy health check |
| `web/wrangler.toml` | **DELETE** — no longer using Workers |

## Manual Steps (Cloudflare Dashboard)

1. Create R2 bucket `yourbro-web` with custom domain `yourbro.ai`
2. Create R2 API token, add GitHub Secrets
3. Verify DNS: `yourbro.ai` (R2), `api.yourbro.ai` (VPS A record)
4. Create Redirect Rule: `/p/*` → `api.yourbro.ai/p/*`
5. Verify Google OAuth redirect URI

## Acceptance Criteria

- [ ] `yourbro.ai` serves frontend from R2 (not Workers, not `.workers.dev`)
- [ ] `yourbro.ai/assets/*` returns hashed Vite assets with correct content
- [ ] `yourbro.ai/` returns `index.html` (SPA fallback via Transform Rule)
- [ ] `yourbro.ai/#/dashboard` loads the SPA correctly
- [ ] `yourbro.ai/p/mehanig/hello` redirects (301) to `api.yourbro.ai/p/mehanig/hello`
- [ ] Page renders correctly at `api.yourbro.ai/p/mehanig/hello` (session cookie sent)
- [ ] Google OAuth login works end-to-end
- [ ] `api.yourbro.ai/health` returns 200
- [ ] Frontend pipeline deploys versioned builds to R2 and updates Transform Rules
- [ ] API pipeline has post-deploy health check
- [ ] `web/wrangler.toml` is deleted

## References

- hunder-app R2 deploy: `../hunder-app/.github/workflows/web-deploy.yml`
- Cloudflare R2 custom domains: https://developers.cloudflare.com/r2/buckets/public-buckets/#custom-domains
- Cloudflare Transform Rules: https://developers.cloudflare.com/rules/transform/
- Cloudflare Redirect Rules: https://developers.cloudflare.com/rules/url-forwarding/
- Completed split plan: `docs/plans/2026-03-05-refactor-split-frontend-backend-deployment-plan.md`

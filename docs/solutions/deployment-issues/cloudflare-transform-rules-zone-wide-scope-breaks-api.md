---
title: "Cloudflare Transform Rules apply zone-wide, breaking API subdomain"
category: deployment-issues
tags:
  - cloudflare
  - transform-rules
  - redirect-rules
  - r2
  - zone-scope
  - api-routing
module: deploy
symptom: "All API routes on api.yourbro.ai return 404 after frontend R2 deploy with Transform Rules"
root_cause: "Cloudflare rules apply to entire zone (all subdomains) unless filtered by http.host"
date: 2026-03-05
---

# Cloudflare Transform Rules Apply Zone-Wide, Breaking API

## Symptom

After deploying the frontend to Cloudflare R2 with Transform Rules for SPA routing, all API routes on `api.yourbro.ai` started returning 404. This included `/health`, `/auth/google`, and all other endpoints. The Go chi router was running (response headers confirmed chi middleware) but couldn't match any routes.

Login was completely broken — clicking "Sign in with Google" redirected to `api.yourbro.ai/auth/google` which returned 404.

## Investigation

1. **Deploy succeeded**: R2 upload and Transform Rules API call both returned 200
2. **API server running**: Response headers showed chi middleware — the Go server was up
3. **Health check 404**: `curl https://api.yourbro.ai/health` → 404
4. **Checked Transform Rules expressions**: No host filter — rules matched ALL paths on ALL hosts in the zone

## Root Cause

Cloudflare Transform Rules and Redirect Rules apply to the **entire zone** (all subdomains), not just a specific hostname. The rules were:

```
# This matches api.yourbro.ai too!
(starts_with(http.request.uri.path, "/assets/"))
```

The SPA fallback rule was the worst offender:
```
# Everything that isn't an asset gets rewritten to index.html
(not starts_with(http.request.uri.path, "/assets/") and not ends_with(...))
→ rewrite to /build-3/index.html
```

So `api.yourbro.ai/health` was being rewritten to `/build-3/index.html`. The chi router on the VPS received `/build-3/index.html` and returned 404.

## Fix

Added `http.host eq "yourbro.ai"` to ALL rule expressions — 3 Transform Rules and 1 Redirect Rule:

**Before:**
```
(starts_with(http.request.uri.path, "/assets/"))
```

**After:**
```
(http.host eq "yourbro.ai" and starts_with(http.request.uri.path, "/assets/"))
```

Applied to all 4 rules in `.github/workflows/web-deploy.yml`.

## Verification

```bash
curl -s https://api.yourbro.ai/health
# {"status":"ok"}

curl -s https://yourbro.ai/
# <html>... SPA index.html ...
```

## Prevention

### Always scope Cloudflare rules by host

When a zone has multiple subdomains (e.g., `yourbro.ai` + `api.yourbro.ai`), **every rule expression must include a host filter**:

```
(http.host eq "yourbro.ai" and <your condition>)
```

### Post-deploy health checks

The web deploy pipeline should verify BOTH the frontend AND the API after updating rules:

```yaml
- name: Verify deployment
  run: |
    # Check frontend
    curl -sf https://yourbro.ai/ > /dev/null
    # Check API wasn't broken
    curl -sf https://api.yourbro.ai/health > /dev/null
```

### Cloudflare rule types affected

All zone-level rule types are zone-wide:
- Transform Rules (`http_request_transform`)
- Redirect Rules (`http_request_dynamic_redirect`)
- Cache Rules
- Page Rules

## Related

- `docs/plans/2026-03-05-fix-deployment-pipeline-readiness-plan.md` — R2 deployment plan
- `.github/workflows/web-deploy.yml` — the pipeline with corrected rules
- `docs/solutions/integration-issues/google-oauth-missing-env-vars-production-deploy.md` — another deploy issue

---
title: "Google OAuth Missing client_id Error on Production Deploy"
date: "2026-03-05"
category: "integration-issues"
tags:
  - OAuth
  - Environment Variables
  - Deployment Pipeline
  - Production Bug
  - Google Auth
severity: critical
component: "Deploy Pipeline (.github/workflows/deploy.yml)"
symptom: "Google OAuth returning 'Missing required parameter: client_id' (Error 400) on yourbro.ai"
root_cause: "Deploy pipeline only generated .env on first deploy; new or empty env vars were never patched"
resolution: "Added ensure_env function to deploy script that validates and patches critical env vars on every deploy"
time_to_resolve: "~30 minutes"
prevention_possible: true
---

# Google OAuth Missing client_id Error on Production Deploy

## Symptom

After deploying to production, visiting yourbro.ai and clicking "Sign in with Google" returned:

> Missing required parameter: client_id
> Error 400: invalid_request

## Investigation Steps

1. **Identified the error** — Google OAuth 400 means the OAuth redirect is missing `client_id` in the query string
2. **Checked Go auth handler** — `api/internal/auth/google.go` reads `GOOGLE_CLIENT_ID` from `os.Getenv()`, so an empty env var produces an empty client_id
3. **Examined deploy pipeline** — `.github/workflows/deploy.yml` generates `.env` only on first deploy:
   ```bash
   if [ ! -f /opt/yourbro/.env ]; then
     # Generate .env with secrets
   fi
   ```
4. **Root cause confirmed** — `.env` already existed on the VPS but was missing `GOOGLE_REDIRECT_URL`, and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` were empty or absent

## Root Cause Analysis

The deploy pipeline used a one-time initialization pattern (`if [ ! -f .env ]`). When the `.env` file already existed from a previous deploy:

- New required variables (like `GOOGLE_REDIRECT_URL`) were never added
- Empty or missing values for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` were never patched from GitHub secrets
- The app started successfully but OAuth broke at runtime when users tried to sign in

## Working Solution

Added an `ensure_env` bash function to the deploy step in `.github/workflows/deploy.yml` that runs on **every deploy**, not just the first:

```bash
# Ensure critical env vars are present and non-empty
ENV_FILE="/opt/yourbro/.env"
ensure_env() {
  local key="$1" val="$2"
  if ! grep -qE "^${key}=.+" "$ENV_FILE"; then
    sed -i "/^${key}=/d" "$ENV_FILE"
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}
ensure_env GOOGLE_CLIENT_ID '${{ secrets.GOOGLE_CLIENT_ID }}'
ensure_env GOOGLE_CLIENT_SECRET '${{ secrets.GOOGLE_CLIENT_SECRET }}'
ensure_env GOOGLE_REDIRECT_URL 'https://yourbro.ai/auth/google/callback'
ensure_env FRONTEND_URL 'https://yourbro.ai'
ensure_env DOMAIN 'yourbro.ai'
```

**How it works:**

- `grep -qE "^${key}=.+"` checks the key exists **with a non-empty value**
- If missing or empty, `sed -i` removes any stale line, then appends the correct value
- Runs for all critical env vars on every deploy

## Verification Steps

1. Push to `main` to trigger deploy
2. SSH into VPS and confirm `/opt/yourbro/.env` contains non-empty values for all critical vars
3. Visit yourbro.ai and click "Sign in with Google" — should redirect to Google OAuth consent screen
4. Deploy again and verify env vars are preserved (not duplicated or lost)

## Prevention Strategies

1. **Never use file-existence checks for env var initialization** — always reconcile env vars on every deploy
2. **Add startup validation in the Go app** — fail fast if critical env vars are empty rather than failing at runtime
3. **Add a post-deploy health check** in the workflow that verifies OAuth config is loadable before marking deploy as successful
4. **Maintain `.env.example`** as the single source of truth for required variables — validate against it during deploy

## Related Files

- `.github/workflows/deploy.yml` — deploy pipeline (modified)
- `api/internal/auth/google.go` — Google OAuth config (reads env vars)
- `.env.example` — env var template
- `deploy/setup.sh` — VPS provisioning script (also generates .env)

## Related Documentation

- [SSE Real-Time Dashboard Agent Status](../integration-issues/sse-real-time-dashboard-agent-status.md)
- [Sandboxed Iframe SDK Delivery](../integration-issues/sandboxed-iframe-sdk-delivery-with-keypair-relay.md)

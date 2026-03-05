---
title: "Deploy yourbro web server to Hetzner VPS"
type: feat
status: active
date: 2026-03-05
---

# Deploy yourbro Web Server to Hetzner VPS

## Overview

Set up the yourbro web server (Go API + frontend + SDK + PostgreSQL + nginx) on a Hetzner VPS running Ubuntu 24.04. The domain is yourbro.ai with Let's Encrypt SSL. No source code on the server — Docker images built in GitHub Actions and pushed to GitHub Container Registry (ghcr.io). The VPS only needs a docker-compose file, nginx config, and .env.

## Problem Statement / Motivation

The skill package and agent binary are released, but the main web server (yourbro.ai) has no production deployment yet. Users need the web server running to sign in, create tokens, pair agents, and manage pages.

## Proposed Solution

### Architecture

```
GitHub Actions (on push/tag)
  └── Builds Docker image → pushes to ghcr.io/mehanig/yourbro:latest

Hetzner VPS (yourbro.ai)
  ├── docker-compose.prod.yml  (pulls image from ghcr.io)
  ├── nginx/nginx.conf         (reverse proxy + SSL)
  ├── .env                     (secrets)
  └── Docker services:
      ├── nginx:443     → proxy to api:8080
      ├── api:8080      → ghcr.io/mehanig/yourbro (Go binary + embedded frontend)
      └── postgres:5432 → pgdata volume
```

No git clone, no source code, no build tools on the VPS.

### Known Issues to Fix First

#### 1. Missing SSE streaming in production nginx

`nginx/nginx.conf` is missing the `/api/agents/stream` location block. Without it, SSE events buffer and agent status won't update in real-time.

**Fix:** Add SSE location block before the catch-all `location /` in the HTTPS server block.

#### 2. deploy.sh missing base compose file

`deploy/deploy.sh` uses only `docker-compose.prod.yml` but postgres is defined in `docker-compose.yml`.

**Fix:** No longer relevant — we'll create a new standalone `docker-compose.prod.yml` for the VPS that defines all services (no base file dependency).

#### 3. No CI pipeline to build and push Docker images

Currently no workflow builds and pushes the API image to a registry.

**Fix:** Add GitHub Actions workflow to build and push to ghcr.io.

## Technical Approach

### Phase 1: CI Pipeline for Docker Image (local changes)

Create `.github/workflows/deploy.yml`:
- Trigger: push to `main` or manual `workflow_dispatch`
- Build the multi-stage Dockerfile (SDK + frontend + Go API)
- Push to `ghcr.io/mehanig/yourbro:latest` and `ghcr.io/mehanig/yourbro:<sha>`
- Uses GitHub's built-in `GITHUB_TOKEN` for ghcr.io auth (no extra secrets needed)

Create `deploy/docker-compose.prod.yml` — standalone production compose:
- Pulls `ghcr.io/mehanig/yourbro:latest` (no `build:` context)
- Defines postgres, nginx, and api services
- Mounts nginx.conf and certbot volumes
- Reads `.env` for secrets

Create `deploy/nginx.conf` — production nginx config with SSE fix included.

Create `deploy/setup.sh` — updated VPS setup script:
- Install Docker
- Firewall (UFW)
- Certbot SSL
- Generate .env with random secrets
- Certbot auto-renewal cron
- No git, no source code

Create `deploy/deploy.sh` — simple pull-and-restart:
- `docker compose pull`
- `docker compose up -d`
- Run migrations via `docker compose exec api ./server migrate`

### Phase 2: VPS Setup via SSH

**Pre-requisites:**
1. DNS: `yourbro.ai` A record pointed to VPS IP
2. Google OAuth credentials ready
3. SSH access provided

**Steps:**

```bash
# 1. SSH in as root
ssh root@<VPS_IP>

# 2. Create deploy directory
mkdir -p /opt/yourbro/nginx

# 3. Copy files (from local machine via scp, or inline)
# - /opt/yourbro/docker-compose.yml
# - /opt/yourbro/nginx/nginx.conf
# - /opt/yourbro/deploy.sh
# - /opt/yourbro/setup.sh

# 4. Run setup
cd /opt/yourbro
bash setup.sh

# 5. Fill in Google OAuth credentials
nano .env

# 6. Login to ghcr.io
echo <GITHUB_TOKEN> | docker login ghcr.io -u mehanig --password-stdin

# 7. Deploy
bash deploy.sh
```

### Phase 3: Verification

```bash
# Services running
docker compose ps

# HTTPS works
curl -I https://yourbro.ai

# API responds
curl https://yourbro.ai/api/health

# SSL valid
openssl s_client -connect yourbro.ai:443 -servername yourbro.ai < /dev/null 2>/dev/null | openssl x509 -noout -dates

# Logs
docker compose logs api
docker compose logs nginx
```

## Acceptance Criteria

- [ ] GitHub Actions builds and pushes image to ghcr.io on push to main
- [ ] `https://yourbro.ai` loads the login page
- [ ] Google OAuth sign-in works
- [ ] Dashboard loads after sign-in
- [ ] SSE agent status updates in real-time
- [ ] SSL certificate valid (Let's Encrypt)
- [ ] HTTP redirects to HTTPS
- [ ] Certbot auto-renewal configured
- [ ] Firewall allows only 22, 80, 443
- [ ] No source code on VPS

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| DNS propagation delay | Check with `dig yourbro.ai` before running certbot |
| Certbot fails (port 80 in use) | Run certbot standalone before starting nginx |
| Docker pull auth on VPS | Login to ghcr.io with a GitHub PAT (read:packages scope) |
| Docker build OOM on small VPS | Builds happen in CI, not on VPS — only pulling images |
| Google OAuth redirect mismatch | Verify redirect URL matches Google Cloud Console exactly |
| ghcr.io is private by default | Make package public, or use PAT on VPS |

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `.github/workflows/deploy.yml` | Create | CI: build + push Docker image to ghcr.io |
| `deploy/docker-compose.prod.yml` | Create | Standalone prod compose (pulls from ghcr.io) |
| `deploy/nginx.conf` | Create | Production nginx with SSE fix |
| `deploy/setup.sh` | Update | VPS provisioning (no git clone) |
| `deploy/deploy.sh` | Update | Pull + restart + migrate |
| `nginx/nginx.conf` | Fix | Add SSE streaming location block |

## References

- Existing deploy scripts: `deploy/setup.sh`, `deploy/deploy.sh`
- Production compose: `docker-compose.yml` + `docker-compose.prod.yml`
- Nginx configs: `nginx/nginx.conf`, `nginx/nginx.dev.conf`
- Environment template: `.env.example`
- Main Dockerfile: `Dockerfile` (multi-stage: SDK + frontend + Go API)
- Security audit: `SECURITY_TO_FIX_BEFORE_PUBLIC.md`

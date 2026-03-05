---
title: "nginx bind-mounted config not reloaded by docker compose up -d"
category: deployment-issues
tags:
  - docker-compose
  - nginx
  - websocket
  - bind-mount
  - deploy-pipeline
module: deploy
symptom: "WebSocket agent gets HTTP 426 Upgrade Required despite correct nginx.conf on disk"
root_cause: "docker compose up -d doesn't restart containers when only bind-mounted files change"
date: 2026-03-05
---

# nginx Bind-Mount Config Not Reloaded on Deploy

## Symptom

After deploying the WebSocket relay feature, agents connecting via `wss://api.yourbro.ai/ws/agent` received HTTP 426 "Upgrade Required" instead of 101 WebSocket upgrade. The agent entered a reconnection loop with exponential backoff but never succeeded.

The API server was running fine (`/health` returned 200). The `deploy/nginx.conf` on the VPS had the correct WebSocket upgrade headers.

## Investigation

1. **API is up**: `curl https://api.yourbro.ai/health` → 200 OK
2. **WebSocket upgrade fails**: `curl --http1.1` with upgrade headers → 426
3. **nginx config is correct on disk**: The file at `/opt/yourbro/nginx/nginx.conf` had the WebSocket location block:
   ```nginx
   location /ws/agent {
       proxy_pass http://api:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_read_timeout 86400s;
       proxy_send_timeout 86400s;
   }
   ```
4. **Deploy pipeline copies config**: `.github/workflows/deploy.yml` runs `cp nginx.conf /opt/yourbro/nginx/nginx.conf` then `docker compose up -d`
5. **The 426 comes from the Go server, not nginx**: The Go WebSocket library (`nhooyr.io/websocket`) returns 426 when it doesn't see upgrade headers — meaning nginx was NOT forwarding them

## Root Cause

The nginx container uses a bind mount:

```yaml
volumes:
  - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
```

`docker compose up -d` only recreates containers when:
- The container image changes
- The compose definition changes

Updating a bind-mounted file on the host does NOT trigger container recreation. The nginx process keeps using the old config from memory — it was running a version from before the WebSocket feature was added.

## Fix

Added explicit `docker compose restart nginx` after `docker compose up -d` in the deploy pipeline:

```yaml
# Deploy
cd /opt/yourbro
docker compose pull
docker compose up -d
docker compose restart nginx
```

## Verification

After re-deploying, the agent connected immediately:

```
Connected to relay server: wss://api.yourbro.ai/ws/agent?name=prod-test-agent
```

## Prevention

| Situation | Approach |
|-----------|----------|
| Bind-mounted config files | Always `docker compose restart <service>` after updating |
| Alternative | Use `nginx -s reload` inside the container (avoids full restart) |
| Alternative | Embed config in the image via `COPY` in Dockerfile (rebuild triggers update) |
| Post-deploy | Add health/smoke checks for the specific feature deployed |

**Rule**: If a deploy pipeline updates files that are bind-mounted into containers, explicitly restart those containers.

## Related

- `docs/solutions/integration-issues/sse-real-time-dashboard-agent-status.md` — nginx SSE config (also bind-mounted)
- `deploy/nginx.conf` — the nginx configuration
- `.github/workflows/deploy.yml` — the deploy pipeline

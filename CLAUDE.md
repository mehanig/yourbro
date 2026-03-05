# yourbro

## Build & Run

### Architecture
- **Frontend** (`web/`): Static site deployed to Cloudflare Workers at `yourbro.ai`
- **Backend API** (`api/`): Go server deployed to Hetzner VPS at `api.yourbro.ai`
- **Agent** (`agent/`): Connects to API via WebSocket relay

### Local development

API + database via Docker Compose:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.local.yml up --build
```

Frontend dev server (separate terminal):
```bash
cd web && npm run dev
```
Vite runs on :5173 with proxy to API at :8080.

Production API builds must be done via Docker Compose. Never run `go build` locally.

### Production deploy
- **API**: Pushed via `.github/workflows/deploy.yml` (triggers on `api/`, `sdk/`, `migrations/`, `deploy/` changes)
- **Frontend**: Pushed via `.github/workflows/web-deploy.yml` (triggers on `web/`, `sdk/` changes)

The API `Dockerfile` builds SDK and Go API. Frontend is NOT embedded — it deploys independently to Cloudflare.

### Auth
- Browser auth uses httpOnly `yb_session` cookie (cross-subdomain via `COOKIE_DOMAIN`)
- Agent auth uses Bearer API tokens via Authorization header
- OAuth callback at `api.yourbro.ai/auth/google/callback`, redirects to `yourbro.ai/#/callback`

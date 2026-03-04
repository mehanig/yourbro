# yourbro

## Build & Run

All builds must be done via Docker Compose. Never run `npm run build` or `go build` locally.

### Local development
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.local.yml up --build
```

### Production
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

The main `Dockerfile` builds the frontend (web/), SDK, and Go API in a multi-stage build.

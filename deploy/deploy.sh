#!/usr/bin/env bash
set -euo pipefail

# Deploy/update yourbro services
# Run from /opt/yourbro on the VPS
#
# Expects:
#   - docker-compose.yml (the prod compose file)
#   - nginx/nginx.conf
#   - .env with all secrets filled in
#   - Docker logged into ghcr.io

cd "$(dirname "$0")"

echo "==> Pulling latest images"
docker compose pull

echo "==> Starting postgres"
docker compose up -d postgres

echo "==> Waiting for postgres to be healthy"
until docker compose exec -T postgres pg_isready -U yourbro; do
    sleep 1
done

echo "==> Running migrations"
docker compose exec -T api ./server migrate || {
    echo "==> Starting api for migration"
    docker compose up -d api
    sleep 3
    docker compose exec -T api ./server migrate
}

echo "==> Starting all services"
docker compose up -d

echo "==> Deploy complete"
docker compose ps

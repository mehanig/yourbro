#!/usr/bin/env bash
set -euo pipefail

# Deploy/update yourbro services
cd "$(dirname "$0")/.."

echo "==> Pulling latest code"
git pull

echo "==> Building images"
docker compose -f docker-compose.prod.yml build

echo "==> Starting postgres"
docker compose -f docker-compose.prod.yml up -d postgres

echo "==> Waiting for postgres to be healthy"
until docker compose -f docker-compose.prod.yml exec postgres pg_isready -U yourbro; do
    sleep 1
done

echo "==> Running migrations"
docker compose -f docker-compose.prod.yml run --rm api migrate

echo "==> Starting all services"
docker compose -f docker-compose.prod.yml up -d

echo "==> Deploy complete"
docker compose -f docker-compose.prod.yml ps

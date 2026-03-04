.PHONY: dev api web sdk db migrate clean build-agent

# Start everything for local dev
dev: db api web

# Start Postgres
db:
	docker compose up -d postgres

# Run migrations
migrate: db
	@echo "Running migrations..."
	@for f in migrations/*.sql; do \
		echo "  Applying $$f..."; \
		PGPASSWORD=yourbro psql -h localhost -U yourbro -d yourbro -f "$$f" 2>/dev/null || true; \
	done
	@echo "Migrations complete."

# Build and run API
api:
	cd api && go run ./cmd/server

# Start frontend dev server
web:
	cd web && npm run dev

# Build SDK
sdk:
	cd sdk && npm run build

# Build API binary
build-api:
	cd api && go build -o ../bin/server ./cmd/server

# Install frontend deps
install-web:
	cd web && npm install

# Install SDK deps
install-sdk:
	cd sdk && npm install

# Install all deps
install: install-web install-sdk

# Build agent server binary
build-agent:
	cd agent && CGO_ENABLED=1 go build -o ../bin/agent-server ./cmd/server

# Clean build artifacts
clean:
	rm -rf bin/ web/dist/ sdk/dist/

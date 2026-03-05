---
title: "refactor: Remove direct mode, make relay-only"
type: refactor
status: completed
date: 2026-03-05
---

# Remove Direct Mode — Relay-Only Architecture

## Overview

Remove all "direct mode" code where agents expose a public HTTP port. Relay mode (agent connects outbound via WebSocket) becomes the only connection method. This simplifies the codebase, removes TLS/autocert complexity from the agent, and eliminates the need for users to expose ports or configure domains.

## Files to Modify

### Agent (`agent/`)

#### `agent/cmd/server/main.go`
- [x] Remove `AGENT_DOMAIN` and `AGENT_PORT` env var reads (lines 28-29)
- [x] Remove `YB_AGENT_ENDPOINT` env var (line 84)
- [x] Remove `isRelayMode` detection — agent is always relay (line 82)
- [x] Remove `startHeartbeat()` function entirely (lines 197-222)
- [x] Remove direct-mode HTTP server: TLS/autocert setup (lines 131-165), plain HTTP dev server (lines 166-187)
- [x] Remove `autocert` import
- [x] Keep only the relay client startup path (lines 88-121)
- [x] Agent `main()` becomes: setup router → start relay client. No HTTP listener.

#### `agent/.env.example`
- [x] Remove `AGENT_PORT`, `AGENT_DOMAIN`, `YB_AGENT_ENDPOINT`
- [x] Keep only: `YOURBRO_TOKEN`, `YOURBRO_SERVER_URL`, `YOURBRO_AGENT_NAME`

### API (`api/`)

#### `api/internal/handlers/pages.go`
- [x] Remove `AllowHTTP` field from `PagesHandler` struct
- [x] Remove direct-mode URL validation (lines 57-62, HTTPS check)
- [x] `agent_endpoint` is always `relay:{agent_id}` — simplify validation
- [x] Remove direct-mode meta tag injection path (lines 221-232)
- [x] Keep only relay-mode rendering path

#### `api/internal/handlers/agents.go`
- [x] Remove `Heartbeat()` handler entirely (lines 83-107)
- [x] Remove heartbeat route registration

#### `api/internal/handlers/relay.go`
- [x] No changes needed — already relay-only

#### `api/cmd/server/main.go`
- [x] Remove heartbeat route (`POST /api/agents/heartbeat`)
- [x] Remove `ALLOW_HTTP_AGENT` env var and `AllowHTTP` flag (line 134)

#### `api/internal/storage/postgres.go`
- [x] Simplify `CreateAgent()` — remove direct-mode branch with endpoint (lines 253-260)
- [x] Remove `UpdateHeartbeat()` function (lines 303-315)
- [x] Agent creation always has `endpoint IS NULL`

#### `api/internal/models/models.go`
- [x] Remove `Endpoint *string` from `Agent` struct (or keep as unused nullable for migration safety)
- [x] Remove `LastHeartbeat *time.Time` from `Agent` struct
- [x] Remove `HeartbeatRequest` struct (lines 113-114)
- [x] Remove `Endpoint` from `RegisterAgentRequest` (line 82)

### SDK (`sdk/src/index.ts`)

- [x] Remove `mode: 'direct' | 'relay'` — always relay
- [x] Remove `agentEndpoint` field (unused in relay)
- [x] Remove `signedFetch()` method entirely (lines 192-241) — direct agent HTTP calls gone
- [x] Remove mode branching in `get()`, `set()`, `list()`, `delete()` — always call `relayRequest()`
- [x] Simplify `ClawdStorage.init()` — remove direct-mode fallback (lines 90-95)
- [x] Simplify constructor — remove endpoint param

### Web Frontend (`web/`)

#### `web/src/pages/dashboard.ts`
- [x] Remove pair mode dropdown (relay vs direct selection, lines 190-193)
- [x] Remove endpoint input field and agent name input for direct mode (lines 195-197)
- [x] Remove `updatePairMode()` function (lines 321-334)
- [x] Remove direct-mode pairing logic (lines 434-520): endpoint validation, direct fetch to agent, server registration
- [x] Keep only relay pairing flow
- [x] Remove direct-mode agent display (endpoint URL shown for non-relay agents, line 60)
- [x] Remove direct-mode key revocation path (DELETE to agent endpoint, lines 120-133)

#### `web/src/lib/crypto.ts`
- [x] Remove `signedFetch()` function (lines 204-252) — was used for direct agent calls from dashboard

#### `web/src/lib/api.ts`
- [x] Remove `endpoint` from Agent interface (or make it always null)
- [x] Simplify `registerAgent()` — no endpoint field needed

### Config & Deployment

#### `docker-compose.local.yml`
- [x] Remove `ALLOW_HTTP_AGENT: "true"`

#### `docker-compose.agent.yml`
- [x] Remove `AGENT_PORT` and `AGENT_DOMAIN` env vars
- [x] Remove port mapping for agent container (if any)

#### `nginx/nginx.conf` and `nginx/nginx.dev.conf`
- [x] Remove any proxy rules for direct agent access (if any exist beyond relay WebSocket)

### Documentation

#### `skill/SKILL.md`
- [x] Remove entire "Direct mode (advanced)" section (lines 109-134)
- [x] Remove direct-mode environment variables table
- [x] Remove direct-mode page publish example (lines 230-244)
- [x] Update intro to say relay is the only mode (not "recommended default")

#### `README.md`
- [x] Remove "direct" communication references
- [x] Update architecture description to relay-only
- [x] Remove any mention of exposing agent ports

#### `web/src/pages/login.ts` and `web/src/pages/how-to-use.ts`
- [x] Verify no "direct mode" references remain (likely already clean from recent updates)

### Database Migration

- [x] Add `migrations/009_remove_direct_mode.sql`:
  - Drop `last_heartbeat` column from agents
  - Optionally: drop `endpoint` column (or leave nullable for backward compat)
  - Drop partial unique index on endpoint (from migration 008)

## Acceptance Criteria

- [x] Agent starts in relay mode without any mode detection — no `AGENT_PORT`/`AGENT_DOMAIN` env vars
- [x] Agent has no HTTP listener — only outbound WebSocket to server
- [x] SDK has no `signedFetch` or direct-mode code paths
- [x] Dashboard shows only relay pairing flow (no mode dropdown, no endpoint input)
- [x] Pages always use `relay:{agent_id}` endpoint format
- [x] No heartbeat endpoint or handler exists
- [x] `SKILL.md` documents relay-only setup
- [x] `README.md` updated
- [x] Docker Compose build succeeds
- [x] Existing relay-mode pairing and E2E encryption still works end-to-end

## Gotchas (from docs/solutions/)

- Agent SQLite `authorized_keys` table is still needed for relay mode (stores paired user Ed25519 + X25519 keys)
- Keep CORS `"null"` origin for sandboxed iframes (relay SDK needs it)
- Keep Bearer token auth via URL params (cookies don't work in sandboxed iframes)
- Restart agent container after API rebuild (WebSocket reconnect)

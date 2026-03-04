---
title: "feat: Agent heartbeat and paired agents dashboard"
type: feat
status: active
date: 2026-03-04
---

# Agent Heartbeat and Paired Agents Dashboard

## Overview

After pairing, users have no visibility into whether their agent is alive. The server doesn't even know a pairing happened — it's browser-to-agent only. This feature:

1. Registers paired agents on the yourbro server (during pairing flow)
2. Agent sends heartbeats to the server every 60 seconds using its existing API token
3. Dashboard shows all paired agents with live/dead status

## Key Insight

The agent machine already has an API token (`yb_...`) — the user provides it so ClawdBot can publish pages. The agent data server runs on the same machine. **Just use that same token for heartbeats.** No new auth mechanism needed.

## Proposed Solution

### Flow

```
SETUP (agent machine already has API token from user):

  Agent Machine
  ┌──────────────────────┐
  │ ClawdBot (AI agent)  │ ← uses API token to publish pages
  │ Agent Data Server    │ ← uses SAME token for heartbeats
  │                      │
  │ env: YB_API_TOKEN    │ ← one token, shared
  │ env: YB_SERVER_URL   │
  └──────────────────────┘

PAIRING (enhanced — browser registers agent on server):

Browser                    Agent                     yourbro Server
   │                         │                            │
   ├── POST /api/pair ──────>│                            │
   │   {code, pubkey}        │                            │
   │<── {status: paired} ────│                            │
   │                         │                            │
   ├── POST /api/agents ─────┼───────────────────────────>│
   │   {endpoint, name}      │                            ├── create agent record
   │<── {id} ────────────────┼────────────────────────────│
   │                         │                            │
   │                         │── heartbeat every 60s ────>│  (uses its own API token)
   │                         │   POST /api/agents/heartbeat
   │                         │   Authorization: Bearer yb_...

DASHBOARD:

   ┌─────────────────────────────────────┐
   │ Paired Agents                       │
   │                                     │
   │ ● my-dev-machine  http://local:9443 │  (green = seen < 2min ago)
   │ ○ prod-agent      https://a.com     │  (gray = no heartbeat)
   │                                     │
   │ [Pair New Agent]                     │
   └─────────────────────────────────────┘
```

### Database

New migration `007_create_agents.sql`:

```sql
CREATE TABLE IF NOT EXISTS agents (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL DEFAULT '',
    endpoint TEXT NOT NULL,
    last_heartbeat TIMESTAMPTZ,
    paired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE UNIQUE INDEX idx_agents_user_endpoint ON agents(user_id, endpoint);
```

No token columns — the agent authenticates heartbeats with its existing API token. The server resolves user_id from the token (same as all other authenticated endpoints).

### API Changes

**New model** in `api/internal/models/models.go`:

```go
type Agent struct {
    ID            int64      `json:"id"`
    UserID        int64      `json:"user_id"`
    Name          string     `json:"name"`
    Endpoint      string     `json:"endpoint"`
    LastHeartbeat *time.Time `json:"last_heartbeat"`
    PairedAt      time.Time  `json:"paired_at"`
    IsOnline      bool       `json:"is_online"` // computed: last_heartbeat > now() - 2min
}
```

**New routes** in `api/cmd/server/main.go`:

```
POST   /api/agents              (auth: Bearer)  → register agent
GET    /api/agents              (auth: Bearer)  → list user's agents
DELETE /api/agents/{id}         (auth: Bearer)  → remove agent
POST   /api/agents/heartbeat    (auth: Bearer)  → update last_heartbeat by endpoint
```

All four routes use the same auth middleware (`RequireAuth`). The heartbeat endpoint identifies the agent by matching the user_id (from token) + endpoint (from request body).

**New storage methods** in `api/internal/storage/postgres.go`:

- `CreateAgent(ctx, userID, name, endpoint) → Agent`
- `ListAgents(ctx, userID) → []Agent` (with computed `is_online`)
- `DeleteAgent(ctx, id, userID) → error`
- `UpdateHeartbeat(ctx, userID, endpoint) → error`

### Agent Changes

Agent data server reads two new env vars:

```
YB_API_TOKEN=yb_...          # same token ClawdBot uses to publish pages
YB_SERVER_URL=https://yourbro.ai   # or http://localhost for local dev
```

**Heartbeat goroutine** in `agent/cmd/server/main.go`:

```go
func startHeartbeat(serverURL, apiToken, endpoint string) {
    // Send immediately on startup, then every 60s
    ticker := time.NewTicker(60 * time.Second)
    send := func() {
        body := fmt.Sprintf(`{"endpoint":%q}`, endpoint)
        req, _ := http.NewRequest("POST", serverURL+"/api/agents/heartbeat",
            strings.NewReader(body))
        req.Header.Set("Authorization", "Bearer "+apiToken)
        req.Header.Set("Content-Type", "application/json")
        http.DefaultClient.Do(req)
    }
    send() // immediate first heartbeat
    go func() {
        for range ticker.C {
            send()
        }
    }()
}
```

No SQLite config table needed. No `/api/configure` endpoint needed. Just env vars.

### Dashboard Changes

**`web/src/pages/dashboard.ts`** — add "Paired Agents" section above the existing "Pair Agent" form:

```
┌──────────────────────────────────────────────────────┐
│ Paired Agents                                        │
│                                                      │
│ ● my-machine    http://localhost:9443    [Remove]     │
│ ○ prod-agent    https://agent.com:9443  [Remove]     │
│                                                      │
│ ● = online (heartbeat < 2 min)   ○ = offline         │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ Pair New Agent                                       │
│ [endpoint] [pairing code] [name (optional)] [Pair]   │
└──────────────────────────────────────────────────────┘
```

**`web/src/lib/api.ts`** — add:

```typescript
interface Agent {
    id: number;
    name: string;
    endpoint: string;
    last_heartbeat: string | null;
    paired_at: string;
    is_online: boolean;
}

function listAgents(): Promise<Agent[]>
function registerAgent(endpoint: string, name: string): Promise<Agent>
function deleteAgent(id: number): Promise<void>
```

### Enhanced Pairing Flow

The dashboard pairing handler becomes a 2-step process:

1. **Pair with agent**: `POST {endpoint}/api/pair` (existing)
2. **Register on server**: `POST /api/agents { endpoint, name }`

That's it. The agent handles heartbeats independently using its own API token — no browser involvement needed.

## Acceptance Criteria

- [ ] New `agents` table with migration `007_create_agents.sql`
- [ ] `Agent` model + CRUD storage methods in postgres.go
- [ ] `POST /api/agents` registers agent, dedupes by (user_id, endpoint)
- [ ] `GET /api/agents` lists agents with `is_online` computed field
- [ ] `DELETE /api/agents/{id}` removes agent (owner only)
- [ ] `POST /api/agents/heartbeat` updates `last_heartbeat` by user_id + endpoint
- [ ] Agent reads `YB_API_TOKEN` and `YB_SERVER_URL` env vars
- [ ] Agent heartbeat goroutine POSTs every 60s on startup
- [ ] Dashboard shows paired agents list with green/gray online indicator
- [ ] Dashboard pairing flow registers agent on server after successful pair
- [ ] "Remove" button in dashboard deletes agent from server
- [ ] Agent name field added to pairing form (optional, defaults to endpoint hostname)

## Implementation Order

1. Migration + model + storage methods
2. API routes (register, list, delete, heartbeat) + handler
3. Agent heartbeat goroutine (env vars, startup, 60s ticker)
4. Dashboard: agents list section + enhanced pairing flow
5. Docker compose: add `YB_API_TOKEN` and `YB_SERVER_URL` to agent-server env
6. Test end-to-end: pair → heartbeat → dashboard shows online → stop agent → shows offline

## Files to Change

| File | Change |
|------|--------|
| `migrations/007_create_agents.sql` | New table |
| `api/internal/models/models.go` | `Agent` struct, `RegisterAgentRequest`, `HeartbeatRequest` |
| `api/internal/storage/postgres.go` | CRUD + heartbeat update methods |
| `api/internal/handlers/agents.go` | New handler file |
| `api/cmd/server/main.go` | New routes under `/api/agents` |
| `agent/cmd/server/main.go` | Heartbeat goroutine on startup |
| `web/src/lib/api.ts` | `Agent` interface, `listAgents`, `registerAgent`, `deleteAgent` |
| `web/src/pages/dashboard.ts` | Agents list section + enhanced pairing |
| `docker-compose.local.yml` | Add `YB_API_TOKEN`, `YB_SERVER_URL` to agent-server env |
| `.env.example` | Document `YB_API_TOKEN`, `YB_SERVER_URL` |

## Security Considerations

- Heartbeat uses existing API token auth — no new auth mechanism
- `POST /api/agents/heartbeat` only updates `last_heartbeat` timestamp — no data leakage
- Agent record is scoped to user_id — users only see their own agents
- Unique constraint on (user_id, endpoint) prevents duplicate registrations

---
title: "refactor: Replace agent auto-increment IDs with UUIDs"
type: refactor
status: active
date: 2026-03-07
---

# Replace Agent Auto-Increment IDs with UUIDs

## Problem

Agent IDs are auto-increment BIGSERIAL integers (`1, 2, 3...`). This:
- Exposes total agent count in the system
- Leaks information via URL paths (`/api/relay/42`)
- Is generated server-side, not by the agent itself
- Makes agent rename create a duplicate instead of updating

## Solution

Each agent generates a UUID on first run (stored in local SQLite). The UUID becomes the agent's primary key everywhere - database, API, relay URLs, frontend.

## Technical Approach

### 1. Agent: generate UUID on first run

**File: `agent/internal/storage/sqlite.go`**

The `agent_identity` table already stores the X25519 keypair. Add a `uuid TEXT` column. `GetOrCreateIdentity()` generates a UUID v4 if none exists.

```go
// agent_identity table gains uuid column
CREATE TABLE IF NOT EXISTS agent_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    x25519_private_key BLOB NOT NULL,
    x25519_public_key BLOB NOT NULL,
    uuid TEXT NOT NULL DEFAULT ''
)

// GetOrCreateIdentity() now also generates/returns uuid
type AgentIdentity struct {
    X25519PrivateKey ed25519.PrivateKey
    X25519PublicKey  ecdh.PublicKey
    UUID             string
}
```

If upgrading from old schema (uuid is empty), generate one and UPDATE.

### 2. Agent: send UUID in WebSocket handshake

**File: `agent/internal/relay/client.go`**

Add UUID as query parameter alongside name:

```
/ws/agent?name=relay-agent&uuid=550e8400-e29b-41d4-a716-446655440000
```

### 3. Server DB: change agents table PK to TEXT

**New migration file: `migrations/012_agent_uuid.sql`**

```sql
-- Add uuid column, migrate existing data, swap primary key
ALTER TABLE agents ADD COLUMN uuid TEXT;
UPDATE agents SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
ALTER TABLE agents ALTER COLUMN uuid SET NOT NULL;
CREATE UNIQUE INDEX idx_agents_uuid ON agents(uuid);

-- Drop old unique index and create new one
DROP INDEX IF EXISTS idx_agents_user_name;
CREATE UNIQUE INDEX idx_agents_user_name ON agents(user_id, name);
```

Keep the old `id BIGSERIAL` column for now (foreign key references, analytics). All new code uses `uuid` as the lookup key. The integer `id` becomes an internal-only detail never exposed via API.

### 4. Server models: Agent.ID becomes string

**File: `api/internal/models/models.go`**

```go
type Agent struct {
    ID       string    `json:"id"`        // UUID string
    DBId     int64     `json:"-"`         // internal BIGSERIAL, never exposed
    UserID   int64     `json:"user_id,omitempty"`
    Name     string    `json:"name"`
    PairedAt time.Time `json:"paired_at"`
    IsOnline bool      `json:"is_online"`
}
```

### 5. Server storage: queries use UUID

**File: `api/internal/storage/postgres.go`**

- `CreateAgent(userID, name, uuid)` - INSERT with agent-provided UUID
- `GetAgentByUUID(uuid)` - replaces `GetAgentByID(int64)`
- `GetAgentByUserAndName(userID, name)` - unchanged but returns UUID
- `ListAgents(userID)` - returns UUID as ID
- `DeleteAgent(uuid, userID)` - WHERE uuid = $1

### 6. Relay hub: map key becomes string

**File: `api/internal/relay/hub.go`**

```go
type Hub struct {
    agents map[string]*AgentConn  // uuid → connection (was int64)
}

type AgentConn struct {
    agentUUID string  // was agentID int64
}
```

`HandleAgentWS` receives UUID from query param, looks up or creates agent by `(userID, name)`, verifies UUID matches if agent exists (or stores it if new).

### 7. Handlers: parse UUID instead of int64

**File: `api/internal/handlers/agents.go`**

- `DELETE /api/agents/{id}` - `id` is now a UUID string, no `strconv.ParseInt`

**File: `api/internal/handlers/relay.go`**

- `POST /api/relay/{agent_id}` - `agent_id` is now a UUID string

**File: `api/internal/handlers/pages.go`**

- `GET /api/page-agents/{username}` - returns `{"agent_ids": ["uuid1", "uuid2"]}`

### 8. SSE broker: update type signatures

**File: `api/internal/handlers/sse.go`**

- `lastState` map changes from `map[int64]map[int64]bool` to `map[int64]map[string]bool`

### 9. Frontend: Agent.id becomes string

**File: `web/src/lib/api.ts`**

```typescript
export interface Agent {
  id: string;  // was number
  name: string;
  paired_at: string;
  is_online: boolean;
}

export async function listPagesViaRelay(agentId: string): Promise<Page[]> { ... }
export function deleteAgent(id: string): Promise<void> { ... }
```

### 10. Frontend hooks: update type signatures

- `usePairingStatus.ts` - `Map<string, PairingStatus>` (was `Map<number, ...>`)
- `usePages.ts` - agent ID comparisons already work with strings
- `useAgentStream.ts` - no change needed (just receives Agent[])

### 11. Frontend crypto: already string-compatible

`storeAgentX25519Key(agentId: string, ...)` and `loadAgentX25519Key(agentId: string)` already take string params. IndexedDB keys are `x25519-${agentId}` - works with UUIDs.

### 12. Shell.html: treat agent_ids as strings

**File: `web/public/p/shell.html`**

`agent_ids` array items become strings instead of numbers. JavaScript handles this transparently - no logic changes needed, just URL interpolation continues to work.

## Files to Modify

| File | Change |
|------|--------|
| `agent/internal/storage/sqlite.go` | Add UUID to identity, generate on first run |
| `agent/internal/relay/client.go` | Send UUID in WS query param |
| `migrations/012_agent_uuid.sql` | Add uuid column, backfill, index |
| `api/internal/models/models.go` | Agent.ID string, add DBId int64 |
| `api/internal/storage/postgres.go` | All agent queries use UUID |
| `api/internal/relay/hub.go` | Map key string, AgentConn.agentUUID |
| `api/internal/handlers/agents.go` | UUID path param, no int parsing |
| `api/internal/handlers/relay.go` | UUID path param |
| `api/internal/handlers/pages.go` | Return string IDs |
| `api/internal/handlers/sse.go` | Update type signatures |
| `api/cmd/server/main.go` | WS handler receives UUID param |
| `web/src/lib/api.ts` | Agent.id: string, function signatures |
| `web/src/hooks/usePages.ts` | Type updates |
| `web/src/hooks/usePairingStatus.ts` | Map<string, ...> |
| `web/src/hooks/useAgentStream.ts` | Type flows through |
| `web/src/components/*.tsx` | Type signature updates |
| `web/public/p/shell.html` | String agent_ids |

## Acceptance Criteria

- [ ] Agent generates UUID v4 on first run, persists in SQLite
- [ ] Existing agents get backfilled UUID via migration
- [ ] UUID sent in WebSocket handshake query param
- [ ] All API responses use UUID string for agent ID
- [ ] Auto-increment integer never exposed in API responses
- [ ] `/api/relay/{uuid}` works with UUID path param
- [ ] `/api/agents/{uuid}` DELETE works
- [ ] Frontend agent operations work with string IDs
- [ ] Shell.html page loading works with UUID agent IDs
- [ ] Agent rename updates name on existing UUID record (not creating duplicate)
- [ ] IndexedDB agent key storage works with UUID keys
- [ ] SSE agent stream sends UUID-based agents

## Migration Strategy

- Server migration adds `uuid` column, backfills existing agents with `gen_random_uuid()`
- Agent migration: on startup, if `uuid` column missing in SQLite, add it and generate UUID
- Existing paired browsers will have IndexedDB keys like `x25519-123` (old int). After migration, new keys will be `x25519-<uuid>`. Old keys become orphaned. User must re-pair. This is acceptable (re-pairing takes 30 seconds).

## Edge Cases

- **Two agents with same name**: UUID makes them distinct. Server can now differentiate by UUID even if names collide.
- **Agent name change**: Same UUID, different name. `HandleAgentWS` looks up by UUID first, updates name if changed.
- **Old agent reconnects without UUID**: Backward compat period - fall back to (userID, name) lookup, assign UUID on reconnect.

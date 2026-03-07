---
title: "Agent fails to connect after UUID refactor — missing SQLite migration and stale database path"
category: runtime-errors
tags: [uuid-migration, sqlite, schema-migration, websocket, agent-startup, deployment, env-vars]
module: Agent
symptom: "Agent binary returns HTTP 400 on WebSocket connection; 'no such column: uuid' from SQLite; /data/agent.db not found on bare-metal"
root_cause: "Three-part failure: (1) CREATE TABLE IF NOT EXISTS doesn't add columns to existing tables, (2) default SQLITE_PATH=/data/agent.db is Docker-only, (3) SQLITE_PATH env var name is too generic"
date: 2026-03-07
---

# Agent Fails to Connect After UUID Refactor

## Symptom

After deploying the UUID refactor (replacing auto-increment agent IDs with UUIDs), the agent binary failed to connect to the relay server:

1. **HTTP 400** on WebSocket connection to `/ws/agent` with message "uuid query parameter is required"
2. **SQLite error**: `no such column: uuid` when querying `agent_identity` table
3. **Path error**: `/data/agent.db` doesn't exist on bare-metal/systemd installs

## Root Cause

### 1. SQLite schema migration gap

SQLite's `CREATE TABLE IF NOT EXISTS` does **not** add new columns to existing tables. The `agent_identity` table existed from the old binary without the `uuid` column. When `GetOrCreateIdentity()` ran `SELECT x25519_private_key, x25519_public_key, uuid FROM agent_identity`, it failed because the column didn't exist.

This error was not `sql.ErrNoRows` — it was a schema error, which caused `GetOrCreateIdentity()` to return an error and the agent to fail on startup (before it could even attempt the WebSocket connection).

### 2. Docker-only default path

The default `SQLITE_PATH` was hardcoded to `/data/agent.db` — a Docker volume mount path. On bare metal (systemd service, ClawdBot skill binary), `/data/` doesn't exist and the process lacks permission to create it.

### 3. Generic env var name

`SQLITE_PATH` is too generic and could collide with other tools on the same system that use SQLite.

## Solution

### Fix 1: Add column migration in `NewDB()`

**File: `agent/internal/storage/sqlite.go`**

Added migration logic that runs before any code queries the `uuid` column:

```go
// In NewDB(), after CREATE TABLE IF NOT EXISTS but before usage:
if hasAgentIdentityTable(db) && !hasColumn(db, "agent_identity", "uuid") {
    log.Println("Adding uuid column to agent_identity table")
    db.Exec(`ALTER TABLE agent_identity ADD COLUMN uuid TEXT NOT NULL DEFAULT ''`)
}
```

Helper functions use `PRAGMA table_info()` to inspect schema:

```go
func hasAgentIdentityTable(db *sql.DB) bool {
    var name string
    err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_identity'`).Scan(&name)
    return err == nil
}

func hasColumn(db *sql.DB, table, column string) bool {
    rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
    if err != nil {
        return false
    }
    defer rows.Close()
    for rows.Next() {
        var cid int
        var name, typ string
        var notNull int
        var dflt sql.NullString
        var pk int
        if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
            continue
        }
        if name == column {
            return true
        }
    }
    return false
}
```

### Fix 2: Smart default path with auto-mkdir

**File: `agent/cmd/server/main.go`**

Changed default from `/data/agent.db` to `~/.yourbro/agent.db`:

```go
sqlitePath := getEnv("YOURBRO_SQLITE_PATH", "")
if sqlitePath == "" {
    home, err := os.UserHomeDir()
    if err != nil {
        home = "."
    }
    sqlitePath = home + "/.yourbro/agent.db"
}
if err := os.MkdirAll(sqlitePath[:strings.LastIndex(sqlitePath, "/")], 0755); err != nil {
    log.Printf("Warning: could not create directory for %s: %v", sqlitePath, err)
}
```

Docker Compose files override to `/data/agent.db` via env var — unchanged behavior for Docker deployments.

### Fix 3: Rename env var to `YOURBRO_SQLITE_PATH`

Renamed across 8 files:
- `agent/cmd/server/main.go` — Go code
- `docker-compose.agent.yml`, `docker-compose.agent-prod.yml` — Docker Compose
- `skill/contrib/docker-compose.yml` — skill template
- `skill/contrib/yourbro-agent.service` — systemd template
- `agent/.env.example` — example env
- `skill/SKILL.md`, `README.md` — documentation

## Key Insights

1. **`CREATE TABLE IF NOT EXISTS` is not a migration tool.** It's a one-time bootstrap. Any column added after initial release requires explicit `ALTER TABLE` migration logic.

2. **When a binary runs in both Docker and bare-metal**, default paths must target user-writable locations (`$HOME`). Docker deployments override via env vars.

3. **Namespace env vars with the project name** (`YOURBRO_` prefix) to avoid collisions. Especially important for common terms like `SQLITE_PATH`, `DB_PATH`, `PORT`.

## Prevention

- **Use `PRAGMA user_version`** for lightweight SQLite migration tracking — a single integer in the file header, no extra tables needed.
- **Test schema upgrades**: create a DB with old schema, run migrations, verify new columns exist.
- **Test fresh installs**: point agent at empty temp directory, verify it creates DB and reaches "connecting" state.
- **CI check**: grep for unprefixed `os.Getenv()` calls — everything should use `YOURBRO_` prefix or be in an explicit allowlist.

## Related

- Plan: `docs/plans/2026-03-07-refactor-agent-uuid-identity-plan.md` — the UUID refactor that triggered this
- Plan: `docs/plans/2026-03-05-feat-restructure-skill-agent-for-openclaw-plan.md` — includes path default changes
- Solution: `docs/solutions/integration-issues/e2e-encrypted-relay-agent-sandboxed-iframe-integration.md` — related SQLite migration patterns

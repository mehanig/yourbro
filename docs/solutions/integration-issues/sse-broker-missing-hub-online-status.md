---
title: "SSE Broker Shows Agents Offline Despite Active WebSocket Connection"
category: integration-issues
tags: [sse, websocket, online-status, dashboard, hub, real-time]
module: api/handlers
symptom: "Agent connected via WebSocket (visible in server logs) but dashboard shows agent as offline"
root_cause: "SSEBroker.sendAgents() fetched agents from DB but never called Hub.IsOnline() — IsOnline defaults to false"
date: 2026-03-05
---

# SSE Broker Shows Agents Offline Despite Active WebSocket Connection

## Problem

After agent connected via WebSocket relay (confirmed in server logs: "Agent N connected via WebSocket"), the dashboard displayed the agent with a gray dot (offline). The REST API endpoint `GET /api/agents` correctly returned `is_online: true`, but the SSE real-time stream always sent `is_online: false`.

## Investigation

1. `AgentsHandler.List()` (`agents.go:50-54`) enriches agents with `Hub.IsOnline()` — REST returns correct status
2. `SSEBroker.sendAgents()` (`sse.go:69`) only calls `DB.ListAgents()` — no Hub reference
3. The `Agent` struct has `IsOnline bool` which defaults to `false`
4. The dashboard uses `EventSource` on `/api/agents/stream` (SSE), not REST polling
5. The SSE broker had no reference to the Hub at all

## Root Cause

The `SSEBroker` struct had a `DB` field but no `Hub` field. When `sendAgents()` fetched agents from the database, the `IsOnline` field was always the zero value (`false`). The REST endpoint and SSE endpoint used different enrichment logic — a consistency bug.

## Solution

Three changes:

**1. Add Hub field to SSEBroker** (`api/internal/handlers/sse.go`):

```go
type SSEBroker struct {
    DB  *storage.DB
    Hub interface{ IsOnline(int64) bool } // set after Hub is created
    // ...
}
```

**2. Enrich agents in sendAgents()** (`api/internal/handlers/sse.go`):

```go
func (b *SSEBroker) sendAgents(userID int64) {
    agents, err := b.DB.ListAgents(ctx, userID)
    // ...

    // Enrich with online status from Hub
    if b.Hub != nil {
        for i := range agents {
            agents[i].IsOnline = b.Hub.IsOnline(agents[i].ID)
        }
    }

    // ... marshal and broadcast
}
```

**3. Wire Hub in main.go** (`api/cmd/server/main.go`):

```go
relayHub := relay.NewHub(db, sseBroker.NotifyUser)
sseBroker.Hub = relayHub  // added
```

## Verification

1. Rebuild API: `docker compose ... build api`
2. Restart API and agent
3. Dashboard now shows green dot for connected agents via SSE

## Gotchas

- REST and SSE are **separate code paths** — both must enrich with the same data
- The 30-second stale checker (`StartStaleChecker`) also calls `sendAgents()` and benefits from this fix
- When adding new fields that depend on runtime state (not DB), check all code paths that serialize the model

## Related

- [SSE Real-Time Dashboard Agent Status](./sse-real-time-dashboard-agent-status.md)
- [E2E Encrypted Relay Agent Integration](./e2e-encrypted-relay-agent-sandboxed-iframe-integration.md)

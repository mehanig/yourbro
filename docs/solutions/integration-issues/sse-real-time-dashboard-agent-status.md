---
title: Real-Time Agent Status on Dashboard via Server-Sent Events
category: integration-issues
tags: [sse, server-sent-events, go, typescript, nginx, real-time, heartbeat, eventsource]
module: Dashboard, Agent Heartbeat
symptom: Dashboard showed static agent online/offline status requiring manual page refresh
root_cause: No mechanism to push state changes from server to browser
date: 2026-03-04
---

# Real-Time Agent Status on Dashboard via Server-Sent Events

## Problem

Dashboard showed static agent online/offline status. Users had to manually refresh the page to see if agents were online or offline. When an agent stopped, stale data persisted on the dashboard.

## Design Decisions

**SSE vs WebSockets**: Chose SSE — unidirectional (server→client only) which is all we need. Simpler to implement and debug than full-duplex WebSockets.

**Event-driven vs polling**: First implementation had a stale checker broadcasting every 30 seconds regardless of state change. User caught this: *"Why not only send when heartbeat comes? We don't need repeating that it's offline every 30 seconds."* Fixed by tracking per-user agent state and only broadcasting when state actually flips.

## Solution

### 1. SSE Broker (`api/internal/handlers/sse.go`)

Per-user channel management with state change tracking:

```go
type SSEBroker struct {
    DB        *storage.DB
    mu        sync.Mutex
    clients   map[int64]map[chan []byte]struct{} // userID → set of channels
    lastState map[int64]map[int64]bool           // userID → agentID → was_online
}
```

Key methods:
- `NotifyUser(userID)` — called on heartbeat receive, always sends current state
- `checkAndNotifyIfChanged(userID)` — called by stale checker, compares current vs previous `is_online`, only broadcasts if different
- `sendAgents(userID)` — fetches from DB, marshals JSON, updates `lastState`, pushes to all user channels

### 2. Heartbeat Trigger (`api/internal/handlers/agents.go`)

After successful heartbeat update, immediately notify SSE clients:

```go
if err := h.DB.UpdateHeartbeat(r.Context(), userID, req.Endpoint); err != nil {
    // ...
}
if h.Broker != nil {
    h.Broker.NotifyUser(userID)
}
```

### 3. Stale Checker

Goroutine runs every 30s but only broadcasts when state changes:

```go
func (b *SSEBroker) checkAndNotifyIfChanged(userID int64) {
    agents, _ := b.DB.ListAgents(ctx, userID)
    prev := b.lastState[userID]
    changed := false
    for _, a := range agents {
        wasOnline, existed := prev[a.ID]
        if !existed || wasOnline != a.IsOnline {
            changed = true
            break
        }
    }
    if changed {
        b.sendAgents(userID)
    }
}
```

### 4. EventSource Client (`web/src/pages/dashboard.ts`)

```typescript
const token = localStorage.getItem("yb_session");
const evtSource = new EventSource(`/api/agents/stream?token=${encodeURIComponent(token || "")}`);
evtSource.onmessage = (event) => {
    const agents: Agent[] = JSON.parse(event.data);
    renderAgentsList(agents, container);
};
// Cleanup on navigation
window.addEventListener("hashchange", () => evtSource.close());
```

Token passed as query param because **EventSource doesn't support custom headers**.

### 5. Auth Middleware (`api/internal/middleware/auth.go`)

Fallback to query param when Authorization header is missing:

```go
if header == "" {
    if t := r.URL.Query().Get("token"); t != "" {
        header = "Bearer " + t
    }
}
```

### 6. Nginx Config (`nginx/nginx.dev.conf`)

Dedicated location block — without this, nginx buffers SSE and events arrive in batches:

```nginx
location /api/agents/stream {
    proxy_pass http://api:8080;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    chunked_transfer_encoding off;
}
```

## Data Flow

1. **Agent sends heartbeat** → `POST /api/agents/heartbeat`
2. **Server updates DB** → calls `broker.NotifyUser(userID)`
3. **Broker sends SSE event** → only to that user's connected clients
4. **Dashboard updates dots** → green/gray instantly, no refresh

**Offline detection**: Stale checker runs every 30s, compares `is_online` against `lastState`, broadcasts only on state flip.

## Key Pitfalls

| Pitfall | Solution |
|---------|----------|
| EventSource can't set Authorization header | Pass token as `?token=` query param |
| Nginx buffers SSE responses by default | `proxy_buffering off` in dedicated location block |
| Stale checker spams repeated "still offline" | Track `lastState` map, only send on state change |
| SSE connections leak on navigation | Close EventSource on `hashchange` event |

## Prevention

- Always add `proxy_buffering off` for SSE endpoints in nginx (both dev AND production configs)
- When using EventSource, plan for query-param auth from the start
- Any periodic checker should be state-change-driven, not time-driven
- Clean up long-lived connections on client-side navigation events

## Related

- No existing related docs in `docs/solutions/`

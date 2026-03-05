---
title: "fix: WebSocket keepalive and pairing code renewal"
type: fix
status: completed
date: 2026-03-05
---

# fix: WebSocket Keepalive and Pairing Code Renewal

## Overview

Two related issues with the agent relay connection:

1. **WebSocket drops every ~2 minutes** — Cloudflare enforces a ~100s idle timeout on WebSocket connections. The agent and server exchange no ping/pong frames, so idle connections get killed. The agent reconnects with exponential backoff but the backoff never resets, leading to growing delays.

2. **Pairing code is one-shot** — Generated once at startup with 5-minute expiry. After expiry (or use), the agent is permanently unpaireable until restarted. Users must restart the agent container and race to enter the code within 5 minutes.

## Problem Statement

### WebSocket Disconnection

```
agent-prod-1  | Connected to relay server: wss://api.yourbro.ai/ws/agent?name=prod-test-agent
agent-prod-1  | WebSocket disconnected: failed to read JSON message: failed to get reader: failed to read frame header: EOF
agent-prod-1  | Reconnecting in 997ms...
agent-prod-1  | Connected to relay server: wss://api.yourbro.ai/ws/agent?name=prod-test-agent
agent-prod-1  | WebSocket disconnected: [...] EOF
agent-prod-1  | Reconnecting in 2.121s...
```

**Root cause**: No WebSocket ping/pong keepalive. The `coder/websocket` (nhooyr) library does NOT send automatic pings — the caller must explicitly call `conn.Ping(ctx)`. Cloudflare terminates idle WebSocket connections after ~100 seconds. Nginx timeouts are already set to 86400s (not the issue).

**Secondary issue**: The backoff counter in `client.go:Run()` never resets after a successful connection. After several disconnects, reconnect delay grows to 60s unnecessarily.

### Pairing Code Expiry

```go
// agent/cmd/server/main.go:35-37
pairingCode := generatePairingCode(8)
pairingExpiry := time.Now().Add(5 * time.Minute)
```

Generated once. After 5 minutes or first use, the agent cannot be paired without a full restart. The `PairHandler` struct has no method to regenerate the code.

## Proposed Solution

### Part 1: WebSocket Keepalive (`agent/internal/relay/client.go`)

Add a ping goroutine in `connect()` that sends a WebSocket ping frame every 30 seconds. This keeps Cloudflare, nginx, and any other proxy happy.

```go
// Start keepalive pings (Cloudflare drops idle WS after ~100s)
go func() {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            if err := conn.Ping(ctx); err != nil {
                return
            }
        case <-ctx.Done():
            return
        }
    }
}()
```

Fix backoff reset in `Run()` — reset to 1s after a successful connection that lasted more than 30 seconds (indicating a real connection, not an immediate failure).

### Part 2: Pairing Code Regeneration (`agent/internal/handlers/pair.go`)

Add a `Regenerate()` method to `PairHandler` that creates a fresh code when the current one is expired or used. Run a ticker in `main.go` that calls `Regenerate()` every 5 minutes and logs the new code.

```go
// agent/internal/handlers/pair.go
func (h *PairHandler) Regenerate(genCode func(int) string) string {
    h.mu.Lock()
    defer h.mu.Unlock()
    if !h.used && time.Now().Before(h.PairingExpiry) {
        return h.PairingCode // still valid
    }
    h.PairingCode = genCode(8)
    h.PairingExpiry = time.Now().Add(5 * time.Minute)
    h.attempts = 0
    h.used = false
    return h.PairingCode
}
```

```go
// agent/cmd/server/main.go — after creating pairHandler
go func() {
    ticker := time.NewTicker(5 * time.Minute)
    defer ticker.Stop()
    for range ticker.C {
        code := pairHandler.Regenerate(generatePairingCode)
        log.Printf("=== PAIRING CODE: %s (expires in 5 minutes) ===", code)
    }
}()
```

## Acceptance Criteria

- [ ] Agent WebSocket stays connected for 10+ minutes without EOF disconnects
- [ ] Ping frames sent every 30s (visible in debug logs or Wireshark)
- [ ] Backoff resets to 1s after a successful connection
- [ ] Pairing code auto-regenerates every 5 minutes after expiry
- [ ] New pairing code logged to stdout each time it regenerates
- [ ] Pairing works with regenerated code (not just the initial one)
- [ ] Existing pairing flow unchanged (code, expiry, rate-limit, one-time-use)
- [ ] Build succeeds via Docker Compose

## Implementation Checklist

### `agent/internal/relay/client.go`

- [x] Add ping goroutine in `connect()` — 30s ticker, `conn.Ping(ctx)`
- [x] Cancel ping goroutine when connection closes (use context)
- [x] Fix backoff reset in `Run()` — reset after successful long-lived connection
- [x] Add log line for ping failures (debug level)

### `agent/internal/handlers/pair.go`

- [x] Add `Regenerate(genCode func(int) string) string` method
- [x] Method resets `used`, `attempts`, `PairingExpiry` under mutex
- [x] Method is a no-op if current code is still valid

### `agent/cmd/server/main.go`

- [x] Add ticker goroutine that calls `pairHandler.Regenerate()` every 5 minutes
- [x] Log new pairing code on each regeneration

## References

- `agent/internal/relay/client.go` — WebSocket client with reconnection logic
- `agent/internal/relay/client.go:55-84` — `Run()` method with backoff
- `agent/internal/relay/client.go:86-156` — `connect()` method with read loop
- `agent/cmd/server/main.go:35-47` — Pairing code generation at startup
- `agent/internal/handlers/pair.go:17-25` — `PairHandler` struct
- `agent/internal/handlers/pair.go:36-123` — `Pair()` method
- `api/internal/relay/hub.go:124-158` — Server-side `readLoop()` (no changes needed)
- `deploy/nginx.conf:57-58` — nginx WebSocket timeouts (already 86400s, no changes)
- `docs/solutions/deployment-issues/nginx-bind-mount-config-not-reloaded-on-deploy.md` — Related learning
- `docs/solutions/integration-issues/sse-real-time-dashboard-agent-status.md` — nginx long-lived connection patterns

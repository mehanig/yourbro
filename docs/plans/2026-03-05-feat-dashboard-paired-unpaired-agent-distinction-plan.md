---
title: "feat: Distinguish paired vs unpaired agents in dashboard"
type: feat
status: completed
date: 2026-03-05
---

# Distinguish Paired vs Unpaired Agents in Dashboard

## Overview

When an agent connects via WebSocket relay, the dashboard shows it as "online" — but the user has no idea whether their **browser** is paired with that agent. Pairing is critical: it exchanges Ed25519 signing keys (for request authentication) and X25519 keys (for E2E encryption). Without pairing, the agent rejects all requests from the browser with 401.

Currently, an agent that just connected for the first time looks identical to one that's been paired and working for weeks. Users don't know they need to pair.

## Problem Statement

Three-layer pairing state exists but the dashboard ignores it:

| Layer | Storage | What it means |
|-------|---------|--------------|
| Server record | Postgres `agents` table | Agent has connected at least once with this user's API token |
| Agent authorized keys | Agent SQLite `authorized_keys` | Agent trusts this browser's Ed25519 key |
| Browser keypair + agent X25519 key | IndexedDB | Browser can sign requests and encrypt for this agent |

The server only knows about layer 1. It has **no visibility** into whether the agent has authorized keys (layer 2) or whether this browser has the right keypair (layer 3).

## Proposed Solution

### Browser-side pairing detection via relay probe

Keep the zero-trust model intact — don't leak pairing state to the server. Instead, the **browser probes each online agent** via relay to check if its Ed25519 key is authorized.

#### New agent endpoint: `GET /api/auth-check`

Add a lightweight endpoint on the agent that:
- Requires RFC 9421 signature verification (uses existing `VerifyUserSignature` middleware)
- Returns `200 {"status":"paired","username":"mehanig"}` if the key is authorized
- Returns `401` if not (handled by middleware, no new code needed)

The browser sends this probe (signed, optionally encrypted) to each online agent when the dashboard loads. Based on the response:

- **200** → Agent is paired to this browser → show in "Your Agents" with full controls
- **401 or timeout** → Agent is NOT paired to this browser → show in "Pair New Agent" section
- **Agent offline** → Show greyed out in "Your Agents" if browser has stored X25519 key, otherwise don't show

#### Dashboard UI changes

**Current UI:**
```
Paired Agents          ← misleading name, shows ALL agents
● agent-name  Remove   ← no indication of pairing state

Pair New Agent
[dropdown of online agents] [code] [Pair]
```

**New UI:**
```
Your Agents                          ← agents where browser key is authorized
● agent-name  🔒 E2E  Remove        ← paired + online + encrypted
○ agent-name  🔒 E2E                ← paired + offline

Available Agents                     ← online agents NOT paired to this browser
● new-agent   [Enter pairing code] [Pair]
```

Key differences:
- "Your Agents" only shows agents that responded 200 to auth-check (or offline agents the browser has keys for)
- "Available Agents" shows online agents that returned 401 (need pairing)
- E2E indicator shows when browser has the agent's X25519 key
- Inline pairing code input per agent (no dropdown needed)

## Technical Approach

### Phase 1: Agent endpoint

**File: `agent/cmd/server/main.go`**

Add a simple authenticated endpoint:

```go
r.Route("/api/auth-check", func(r chi.Router) {
    r.Use(mw.VerifyUserSignature(db))
    r.Get("/", func(w http.ResponseWriter, r *http.Request) {
        username := mw.GetUsername(r)
        writeJSON(w, http.StatusOK, map[string]string{
            "status":   "paired",
            "username": username,
        })
    })
})
```

No new middleware, no new storage — just a route behind existing auth.

### Phase 2: Browser probing

**File: `web/src/pages/dashboard.ts`**

After receiving agent list via SSE, for each online agent:

1. Check if browser has a stored Ed25519 keypair (IndexedDB) — if not, all agents are "unpaired"
2. For agents where browser has keys, send signed `GET /api/auth-check` via relay
3. Classify agents into "paired" vs "available" based on response
4. Re-render the agent lists

The probe should be **fire-and-forget per agent** — don't block the initial render. Show a loading state, then update when probes complete.

For E2E encrypted agents (browser has stored agent X25519 key), the probe is encrypted. For agents without stored X25519 key, the probe is sent unencrypted (relay router already handles both).

### Phase 3: Dashboard UI update

**File: `web/src/pages/dashboard.ts`**

- Split agent rendering into two sections
- "Your Agents": paired agents (auth-check returned 200 OR offline agent with stored X25519 key in IndexedDB)
- "Available Agents": online agents where auth-check returned 401 or no browser keys exist
- Each available agent gets an inline pairing code input + Pair button
- Add 🔒 indicator when browser has the agent's X25519 key stored

### Phase 4: Handle edge cases

- **Browser keys cleared**: All agents appear as "available" — user re-pairs
- **Agent keys revoked**: Auth-check returns 401 — agent moves from "Your" to "Available"
- **Multiple browsers**: Each browser has its own Ed25519 key — pairing is per-browser, which is correct
- **Probe timeout**: Treat as "unknown" — show with a "?" indicator, retry on next SSE update

## Files to Modify

| File | Change |
|------|--------|
| `agent/cmd/server/main.go` | Add `GET /api/auth-check` route |
| `web/src/pages/dashboard.ts` | Probe logic + split UI into paired/available sections |
| `web/src/lib/api.ts` | Optional: add `checkAgentPairing(agentId)` helper |

## Acceptance Criteria

- [x] New agent connects → dashboard shows it under "Available Agents" (not "Your Agents")
- [x] After pairing → agent moves to "Your Agents" section
- [ ] Paired agent shows 🔒 E2E indicator when X25519 keys are exchanged
- [x] Offline paired agent shows greyed out in "Your Agents"
- [x] Browser without any keys sees all agents as "Available"
- [x] Revoking keys moves agent back to "Available Agents"
- [x] Auth-check probe doesn't break anything for agents without the new endpoint (timeout → treated as unpaired)

## Dependencies & Risks

- **Backwards compatibility**: Older agents without `GET /api/auth-check` will return 404 — browser should treat 404 same as 401 (unpaired). This is safe.
- **Latency**: Probing each agent adds relay round-trip latency (~100-500ms per agent). For 1-3 agents this is fine. For many agents, parallelize probes.
- **Zero-trust preserved**: Server never learns about pairing state — all probing happens through the relay as opaque messages.

## References

- `agent/internal/handlers/pair.go` — pairing handler with key exchange
- `agent/internal/middleware/auth.go` — RFC 9421 signature verification
- `web/src/pages/dashboard.ts` — current dashboard implementation
- `docs/solutions/security-issues/incomplete-agent-key-revocation-on-removal.md` — three-layer pairing state model
- `docs/solutions/integration-issues/sse-real-time-dashboard-agent-status.md` — SSE patterns for real-time updates

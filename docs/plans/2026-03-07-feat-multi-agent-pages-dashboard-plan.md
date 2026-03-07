---
title: "feat: Multi-agent pages in dashboard"
type: feat
status: completed
date: 2026-03-07
---

# Multi-Agent Pages in Dashboard

## Overview

When a user has multiple agents, the dashboard should fetch and display pages from **all** online paired agents, grouped by agent name. Currently only the first online paired agent's pages are shown - pages on other agents are invisible.

## Problem Statement

- `usePages.ts` picks the **first** online paired agent and only fetches pages from it
- `PagesList` receives a single `agentId` - no multi-agent awareness
- `PageCard` shows no agent attribution
- Users with multiple agents (e.g. laptop + server) cannot see or manage pages across agents from the dashboard

## Proposed Solution

Fetch pages from **all** online paired agents in parallel, group them by agent, and display each group under an agent header showing the agent name and online status.

## Technical Approach

### 1. Update `usePages.ts` - fetch from all paired agents

**File: `web/src/hooks/usePages.ts`**

Current behavior:
```typescript
const onlineAgent = agents.find(
  (a) => a.is_online && getStatus(a.id) === "paired"
);
// fetches from only this one agent
```

New behavior:
- Filter all online + paired agents
- Call `listPagesViaRelay(agentId)` for each in parallel (`Promise.all`)
- Return a `Map<number, Page[]>` (agentId -> pages) instead of a flat `Page[]`
- Keep analytics fetching as-is (it's user-level, not agent-level)
- Remove the single `onlineAgentId` return, replace with the map

```typescript
// New return type
interface AgentPages {
  agent: Agent;
  pages: Page[];
}

// Fetch from all paired online agents
const pairedOnline = agents.filter(
  (a) => a.is_online && getStatus(a.id) === "paired"
);
const results = await Promise.all(
  pairedOnline.map(async (agent) => ({
    agent,
    pages: await listPagesViaRelay(agent.id),
  }))
);
```

### 2. Update `PagesList.tsx` - accept grouped pages

**File: `web/src/components/PagesList.tsx`**

- Change props from `pages: Page[]` + `agentId: number` to `agentPages: AgentPages[]`
- Render each group with an agent header:
  - Agent name (bold)
  - Online status indicator (green dot)
  - Page count
- Under each header, render `PageCard` items with the correct `agentId` for delete actions
- Empty state: if no paired agents, show current "pair an agent" message
- Empty state per agent: if an agent has 0 pages, show "No pages on this agent"

### 3. Update `PageCard.tsx` - no changes needed

The component already receives `agentId` as a prop for deletion. No changes required - it will just receive the correct agent's ID from the parent.

### 4. Update `DashboardPage.tsx` - pass new data shape

**File: `web/src/pages/DashboardPage.tsx`**

- Update destructuring of `usePages` return value
- Pass `agentPages` array to `PagesList` instead of flat `pages` + single `agentId`
- Update `handleDelete` to work with per-page `agentId` (already does, just needs the right ID)

### 5. Analytics consideration

**No changes needed.** Analytics (`page_views` table) tracks `(user_id, slug)` without `agent_id`. This is correct for now - if the same slug exists on two agents, views are shared. This matches the public page fan-out behavior where any agent can serve a slug.

## Files to Modify

| File | Change |
|------|--------|
| `web/src/hooks/usePages.ts` | Fetch from all paired agents, return `AgentPages[]` |
| `web/src/components/PagesList.tsx` | Accept grouped data, render agent headers |
| `web/src/pages/DashboardPage.tsx` | Pass new data shape to PagesList |

## Acceptance Criteria

- [x] Dashboard fetches pages from all online paired agents in parallel
- [x] Pages are grouped by agent with agent name as section header
- [x] Each agent group shows the agent name and page count
- [x] Page deletion works correctly (uses the right agentId for each page)
- [x] Analytics button still works per page
- [x] Empty states: "Pair an agent" when none paired, "No pages" per empty agent
- [x] Single agent case looks the same as before (just with agent name header)
- [x] Loading states work correctly (show loading per agent or globally)

## Edge Cases

- **Duplicate slugs across agents**: Both appear under their respective agent groups. The dashboard detects duplicates client-side and shows a warning badge ("This slug also exists on [other-agent]"). Public page serving uses first-responder (non-deterministic), so the user should delete the unwanted copy. Server-side enforcement is impossible since agents store pages independently on their own filesystem with no server knowledge.
- **One agent online, one offline**: Only show pages from the online agent. Optionally show offline agent with "(offline)" label and no pages.
- **Agent goes offline during fetch**: `listPagesViaRelay` returns `[]` on failure - agent group shows as empty or is omitted.
- **No agents paired**: Current empty state message shown.

## Context

- Pages are stored on each agent's filesystem (not server-side - dropped in migration 010)
- `listPagesViaRelay` already targets a specific agent by ID
- Public page serving already does fan-out across all agents (`api/cmd/server/main.go:248-316`)
- Agent online status is tracked in-memory in the relay Hub

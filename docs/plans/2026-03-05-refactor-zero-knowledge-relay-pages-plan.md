---
title: "Zero-Knowledge Relay Pages"
type: refactor
status: active
date: 2026-03-05
---

# Zero-Knowledge Relay Pages

## Overview

Eliminate all server-side page storage. The yourbro server becomes a pure relay — it never stores, sees, or serves user HTML content. Pages are fetched on-demand from the agent via the existing WebSocket relay channel. If the agent is offline, the page shows an "agent offline" message.

**Pages are private.** Only the page owner (authenticated user who owns the agent) can view their pages. The `/p/{username}/{slug}` route requires login — unauthenticated visitors are redirected to sign in. This is intentional: yourbro pages are personal dashboards and tools, not public websites.

## Problem Statement

Currently, agents publish page HTML to the yourbro server (`POST /api/pages`), which stores it in Postgres (`pages.html_content`). The server then serves this HTML to visitors. This means:
- yourbro stores user content (violates zero-knowledge promise)
- Pages work without the agent (stale data possible)
- Server is a liability — it holds user HTML in plaintext (or encrypted, but still holds it)
- The `pages` table is the only table with actual user content

## Proposed Solution

Remove the `pages` table entirely from Postgres. The agent stores its own pages in SQLite and serves them on-demand via the relay. The server only needs `users` and `agents` tables for auth/routing.

### New Page Load Flow

```
Browser visits /p/{username}/{slug}
        |
        v
Server: look up user by username, find online agents
        |
        v
Server: render shell template with agent IDs + SDK bootstrap
        |
        v
Shell JS: fetch /api/content-token (get JWT for relay auth)
        |
        v
Shell JS: POST /api/relay/{agent_id}
          body: { method: "GET", path: "/api/page/{slug}" }
        |
        v (WebSocket relay)
Agent: GET /api/page/{slug} → returns { title, html, slug }
        |
        v (relay response)
Shell JS: inject SDK + meta tags into HTML
Shell JS: set iframe.srcdoc = enriched HTML
        |
        v
Sandboxed iframe with SDK loaded, ready for storage ops
```

### What the Server Stores (After)

| Table | Purpose | User Content? |
|-------|---------|---------------|
| `users` | Auth, username lookup | No (just email/username) |
| `agents` | Agent registration, WS routing | No (just name/user_id) |
| `tokens` | API tokens for auth | No |
| `schema_migrations` | Migration tracking | No |
| `authorized_keys` (agent SQLite) | Ed25519 public keys | No |
| `pages` (agent SQLite) | **NEW** — HTML content | Yes, but on user's machine |

## Technical Approach

### Phase 1: Agent-Side Page Storage

**Agent SQLite — new `pages` table:**

```sql
-- agent/internal/storage/sqlite.go
CREATE TABLE IF NOT EXISTS pages (
    slug         TEXT PRIMARY KEY,
    title        TEXT NOT NULL DEFAULT '',
    html_content TEXT NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Agent — new handlers** (`agent/internal/handlers/pages.go`):

```
GET    /api/pages              → list pages [{slug, title, updated_at}]
GET    /api/page/{slug}        → get page {slug, title, html_content}
PUT    /api/page/{slug}        → create/update page {title, html_content}
DELETE /api/page/{slug}        → delete page
```

All routes require RFC 9421 signature verification (same as storage routes). The agent skill (`SKILL.md`) changes from `POST /api/pages` on the server to `PUT /api/page/{slug}` via relay to itself.

**Files to modify/create:**
- [x] `agent/internal/storage/sqlite.go` — add pages table + CRUD methods
- [x] `agent/internal/handlers/pages.go` — **new file**, page handlers
- [x] `agent/cmd/server/main.go` — register new routes on chi mux

### Phase 2: Server Shell Redesign

**Modify `/p/{username}/{slug}` shell** to fetch HTML via relay instead of from Postgres.

The shell template becomes a relay bootstrapper:

1. Server renders shell with: username, slug, list of agent IDs for that user
2. Shell JS calls `/api/content-token` to get a JWT (same as current)
3. Shell JS loads keypairs from IndexedDB (same as current)
4. Shell JS makes a relay request: `GET /api/page/{slug}` through `POST /api/relay/{agent_id}`
5. On success: injects received HTML into `iframe.srcdoc` with SDK + meta tags prepended
6. On failure (agent offline / 404): shows appropriate error message

**Key change**: the iframe is no longer loaded via `iframe.src = '/api/pages/{id}/content'`. Instead, the parent page fetches HTML via relay and sets `iframe.srcdoc`. This eliminates the need for the content endpoint entirely.

**SDK injection**: the shell JS prepends the SDK script + meta tags to the agent's HTML before setting `srcdoc`:

```javascript
var enrichedHTML = `
  <meta name="clawd-relay-mode" content="true">
  <meta name="clawd-agent-id" content="${agentId}">
  <meta name="clawd-page-slug" content="${slug}">
  <meta name="clawd-api-base" content="${apiBase}">
  <script>${sdkScript}</script>
` + pageHTML;
iframe.srcdoc = enrichedHTML;
```

**Files to modify:**
- [x] `api/internal/handlers/pages.go` — rewrite `RenderPage`, remove `RenderPageContent`, remove `pageHostTemplate`, new template
- [x] `api/cmd/server/main.go` — remove `/api/pages/{id}/content` route, remove pages routes under `/api`

### Phase 3: Dashboard — Pages from Agent

Currently the dashboard calls `GET /api/pages` to list the user's pages from Postgres. In the new model, the page list comes from the agent via relay.

**Dashboard changes:**
- Instead of `fetch('/api/pages')`, call `POST /api/relay/{agent_id}` with `GET /api/pages`
- If agent is offline, show "Agent offline — connect your agent to manage pages"
- Page creation goes through relay too (agent stores it)
- Page deletion goes through relay

**Files to modify:**
- [x] `web/src/pages/dashboard.ts` — relay-based page list/create/delete

### Phase 4: Remove Server-Side Page Storage

**Drop pages table from Postgres:**

```sql
-- migrations/009_drop_pages_table.sql
DROP TABLE IF EXISTS pages;
```

**Remove server endpoints:**
- [x] Remove `POST /api/pages` (create)
- [x] Remove `GET /api/pages` (list)
- [x] Remove `GET /api/pages/{id}` (get)
- [x] Remove `GET /api/pages/{id}/content-meta` (content meta)
- [x] Remove `GET /api/pages/{id}/content` (content serving)
- [x] Remove `DELETE /api/pages/{id}` (delete)
- [x] Keep `/api/content-token` endpoint (still needed — shell uses it for iframe SDK auth)

**Remove from codebase:**
- [x] `api/internal/handlers/pages.go` — rewritten to relay-only RenderPage
- [x] `api/internal/storage/postgres.go` — removed page CRUD methods
- [x] `api/internal/models/models.go` — removed `Page`, `CreatePageRequest`
- [x] `api/cmd/server/main.go` — removed page routes, kept `sdkScript` embed (used by relay shell)

### Phase 5: Agent Routing Without Pages Table

The `/p/{username}/{slug}` route needs to know which agent to relay to. Without a pages table, routing works via the `agents` table:

1. Server looks up user by username
2. Server finds all agents for that user (from `agents` table)
3. Shell template receives the list of agent IDs
4. Shell JS tries each online agent via relay until one responds with the page

For most users (single agent), this is one relay call. For multi-agent users, it's a fallback chain.

**Alternative (simpler for MVP)**: just use the first registered agent for the user. If user has multiple agents, they need distinct usernames or a URL scheme like `/p/{username}/{agent_name}/{slug}`.

**Files to modify:**
- [ ] `api/internal/storage/postgres.go` — add `ListAgentsByUserID` query (may already exist)
- [ ] `api/internal/handlers/pages.go` — new `RenderPage` implementation using agent lookup

### Phase 6: Update Agent Skill

The `SKILL.md` currently tells the agent to call `POST /api/pages` on the yourbro server. Change to storing locally:

**Old flow**: Agent → `POST https://api.yourbro.ai/api/pages` (server stores HTML)
**New flow**: Agent → `PUT /api/page/{slug}` on its own local server (agent stores HTML in SQLite)

For relay-mode agents, this means the agent writes to its own storage directly (no relay round-trip needed — it's a local HTTP call to itself).

**Files to modify:**
- [x] `skill/SKILL.md` — update publishing instructions

## Access Control

Pages are **owner-only**. The `/p/{username}/{slug}` route requires authentication:

1. Unauthenticated visitor → shell shows "Sign in to view this page" with login link
2. Authenticated user who is NOT the page owner → relay endpoint rejects (ownership check)
3. Authenticated owner → relay fetches page from their agent

The relay endpoint (`POST /api/relay/{agent_id}`) enforces ownership: `agent.UserID == userID`. This means only the user who owns the agent can fetch pages through it.

## Agent Offline Handling

When the **owner** visits `/p/{username}/{slug}` and agent is offline:

```
Shell JS: tries relay to agent → timeout / agent not connected
Shell JS: shows message:
  "Your agent is currently offline.
   Start your agent to view this page."
```

No fallback, no caching, no stale content. Page only works when agent is live.

## Acceptance Criteria

- [ ] Visiting `/p/{username}/{slug}` requires login — unauthenticated visitors see "sign in" message
- [ ] Authenticated owner sees page fetched from agent via relay (not from Postgres)
- [ ] Non-owner authenticated user cannot view someone else's pages (relay ownership check)
- [ ] Agent offline → clean "agent offline" message (no 500, no stale content)
- [ ] `pages` table dropped from Postgres — no user content on server
- [ ] Dashboard page list comes from agent via relay
- [ ] Page create/delete from dashboard goes through relay to agent
- [ ] Agent stores pages in its own SQLite
- [ ] Agent skill updated — publishes locally, not to server
- [ ] E2E encryption still works for relay page fetches
- [ ] RFC 9421 signatures still verified on agent page endpoints
- [ ] SDK injected into iframe via `srcdoc` (no server content endpoint)
- [ ] Existing page data migration: document that users need to re-publish pages after upgrade

## Security Considerations

- **Zero-knowledge achieved**: server never sees page HTML (encrypted or not)
- **Pages are private**: only the authenticated page owner can view their pages (relay ownership check)
- **iframe sandbox preserved**: `sandbox="allow-scripts"` still isolates page content
- **Auth unchanged**: cookie auth for browser, Bearer token for agents
- **RFC 9421 signatures**: agent page endpoints require the same signature verification as storage endpoints
- **srcdoc security**: `iframe.srcdoc` with `sandbox="allow-scripts"` has same security as `iframe.src` with sandbox — tested in existing learnings

## Migration Path

This is a **breaking change** for existing pages:
1. Deploy agent update first (adds page storage + handlers)
2. Users re-publish their pages (agent skill now stores locally)
3. Deploy server update (drops pages table, new shell)
4. Old page URLs now relay to agent instead of reading from Postgres

## References

- Current relay architecture: `api/internal/relay/hub.go`, `api/internal/handlers/relay.go`
- Sandboxed iframe learnings: `docs/solutions/integration-issues/e2e-encrypted-relay-agent-sandboxed-iframe-integration.md`
- SDK postMessage keypair relay: `docs/solutions/integration-issues/sandboxed-iframe-sdk-delivery-with-keypair-relay.md`
- RFC 9421 TLS mismatch fix: `docs/solutions/integration-issues/relay-router-tls-scheme-mismatch-401.md`

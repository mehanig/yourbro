---
title: "feat: Iframe postMessage Storage Bridge"
type: feat
status: active
date: 2026-03-06
---

# Iframe postMessage Storage Bridge

## Overview

After removing the ClawdStorage SDK injection from shell.html, iframed pages lost the ability to persist data back to the agent. This plan adds a simple postMessage-based bridge: the iframe sends `postMessage` to the parent shell, the shell E2E encrypts and relays the request to the agent's new `/api/page-storage/*` endpoints, then sends the response back via `postMessage`.

No crypto in the iframe. Shell is the encryption proxy. Iframe speaks plain JSON messages.

## Problem Statement

Pages rendered in sandboxed iframes have no way to save or retrieve data. A page like a to-do app, poll, or interactive demo can't persist state. The old SDK was removed because it was complex (keypair relay, RFC 9421 signing in-iframe). We need a simpler path.

## Proposed Solution

```
Iframe JS                    shell.html                      Agent (relay)
─────────                    ──────────                      ─────────────
postMessage({
  type: 'yourbro-storage',  ──►  receive message
  action: 'set',                 E2E encrypt
  key: 'score',                  POST /api/relay/{agentId}  ──►  decrypt
  value: {score: 42}             (encrypted inner req to          route to /api/page-storage/set
})                                /api/page-storage/set)          store in SQLite
                                                              ◄──  encrypted response
                             ◄──  E2E decrypt response
iframe.onmessage({
  type: 'yourbro-storage-response',
  action: 'set',
  ok: true
})                           ◄──  postMessage back to iframe
```

## Changes

### 1. Agent: New `/api/page-storage/*` endpoints

**File: `agent/internal/handlers/page_storage.go`** (new)

New handler `PageStorageHandler` — similar to existing `StorageHandler` but:
- **No auth middleware** — these requests arrive pre-authenticated through the E2E encrypted relay (if the shell can decrypt, the user is paired)
- Slug is scoped from the request body, not URL params
- Endpoints:

```
POST /api/page-storage/get    { "slug": "my-page", "key": "score" }
POST /api/page-storage/set    { "slug": "my-page", "key": "score", "value": {"score": 42} }
POST /api/page-storage/delete { "slug": "my-page", "key": "score" }
POST /api/page-storage/list   { "slug": "my-page", "prefix": "user-" }
```

All POST (not REST-style GET/PUT/DELETE) because the relay wraps everything in a single encrypted payload — method doesn't matter for encrypted inner requests.

Uses the same `storage.DB` methods (`Get`, `Set`, `Delete`, `ListByPrefix`) as existing `StorageHandler`.

**File: `agent/cmd/server/main.go`**

Register new routes (no auth middleware — relay E2E is the auth):
```go
r.Post("/api/page-storage/get", pageStorageHandler.Get)
r.Post("/api/page-storage/set", pageStorageHandler.Set)
r.Post("/api/page-storage/delete", pageStorageHandler.Delete)
r.Post("/api/page-storage/list", pageStorageHandler.List)
```

### 2. Shell: postMessage listener + relay bridge

**File: `web/public/p/shell.html`**

After creating the iframe (line 240), add a `message` event listener on `window`:

```javascript
// 8. Storage bridge — relay iframe postMessage to agent via E2E
window.addEventListener('message', async function(event) {
    if (!event.data || event.data.type !== 'yourbro-storage') return;
    // Only accept messages from our iframe
    if (event.source !== iframe.contentWindow) return;

    var action = event.data.action; // get, set, delete, list
    var innerPath = '/api/page-storage/' + action;
    var innerBody = JSON.stringify({
        slug: slug,
        key: event.data.key,
        value: event.data.value,
        prefix: event.data.prefix
    });

    try {
        // Encrypt and relay (reuse existing e2eEncrypt + relay pattern)
        var innerReq = JSON.stringify({
            id: crypto.randomUUID(),
            method: 'POST',
            path: innerPath,
            body: btoa(innerBody),
            headers: { 'Content-Type': 'application/json' }
        });
        var encrypted = await e2eEncrypt(new TextEncoder().encode(innerReq));
        var resp = await fetch(API + '/api/relay/' + usedAgentId, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: crypto.randomUUID(),
                encrypted: true,
                payload: toBase64(encrypted)
            })
        });

        var result = { ok: false };
        if (resp.ok) {
            var envelope = await resp.json();
            if (envelope.encrypted && envelope.payload) {
                var decrypted = await e2eDecrypt(fromBase64(envelope.payload));
                var innerResp = JSON.parse(new TextDecoder().decode(decrypted));
                if (innerResp.status >= 200 && innerResp.status < 300) {
                    result = { ok: true, data: innerResp.body ? JSON.parse(innerResp.body) : null };
                } else {
                    result = { ok: false, error: innerResp.body || 'Agent error' };
                }
            }
        }

        iframe.contentWindow.postMessage({
            type: 'yourbro-storage-response',
            action: action,
            requestId: event.data.requestId,
            ...result
        }, '*');
    } catch(e) {
        iframe.contentWindow.postMessage({
            type: 'yourbro-storage-response',
            action: action,
            requestId: event.data.requestId,
            ok: false,
            error: e.message
        }, '*');
    }
});
```

Key details:
- `event.source !== iframe.contentWindow` check ensures only our iframe can trigger relay
- `slug` is hardcoded from the URL — iframe can't write to other pages' storage
- `requestId` in the response lets the iframe match responses to requests (for concurrent calls)

### 3. SKILL.md: Document the storage API for ClawdBot

**File: `skill/SKILL.md`**

Add a section to the Usage/Examples area:

```markdown
### Page Storage (data persistence)

Pages can store and retrieve data using `postMessage`. The shell handles
E2E encryption — your page JS just sends plain messages.

**Set a value:**
```js
// In your page's JS (e.g., app.js)
var requestId = crypto.randomUUID();
window.parent.postMessage({
    type: 'yourbro-storage',
    action: 'set',
    key: 'user-score',
    value: { score: 42, level: 3 },
    requestId: requestId
}, '*');

window.addEventListener('message', function handler(event) {
    if (event.data.type === 'yourbro-storage-response' && event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        if (event.data.ok) console.log('Saved!');
    }
});
```

**Get a value:**
```js
window.parent.postMessage({
    type: 'yourbro-storage',
    action: 'get',
    key: 'user-score',
    requestId: crypto.randomUUID()
}, '*');
// Response: { type: 'yourbro-storage-response', action: 'get', ok: true, data: { value: ... } }
```

**List keys:**
```js
window.parent.postMessage({
    type: 'yourbro-storage',
    action: 'list',
    prefix: 'user-',
    requestId: crypto.randomUUID()
}, '*');
```

**Delete a key:**
```js
window.parent.postMessage({
    type: 'yourbro-storage',
    action: 'delete',
    key: 'user-score',
    requestId: crypto.randomUUID()
}, '*');
```

All storage is scoped to the page slug and E2E encrypted through the relay.
Your agent must be online for storage operations to work.
```

### 4. Update CLAUDE.md

Add a note under "Pages architecture":
```
- Iframed pages communicate with the agent via postMessage → shell.html → E2E encrypted relay → agent `/api/page-storage/*` endpoints. No crypto in the iframe — shell is the encryption proxy.
```

## What stays the same

- E2E encryption (X25519 + AES-GCM) — unchanged, shell already has `e2eEncrypt`/`e2eDecrypt`
- Relay infrastructure (`/api/relay/{agentId}`) — unchanged
- Service Worker page caching — unchanged
- Agent relay router (`router.go`) — unchanged (already routes any `/api/*` path)
- Pairing flow — unchanged
- Existing `StorageHandler` at `/api/storage/{slug}/*` — unchanged (used by dashboard, requires RFC 9421 auth)

## Security

| Concern | Mitigation |
|---------|------------|
| Iframe writes to other pages' storage | Shell hardcodes `slug` from URL — iframe can't override it |
| Random page triggers storage on visitor's agent | `event.source === iframe.contentWindow` check — only our iframe accepted |
| Visitor views someone else's page, iframe writes to visitor's agent | Shell uses `usedAgentId` from the page fetch — this is the **page owner's** agent, not the visitor's. Visitor must have E2E keys for that agent (only possible if paired). Visitors who aren't paired see "Encryption keys missing" error and never reach the iframe. |
| Man-in-the-middle on relay | All payloads are AES-256-GCM encrypted end-to-end. Relay server is blind. |
| Iframe exfiltrates data via postMessage to other windows | `sandbox="allow-scripts allow-same-origin"` — iframe can only postMessage to parent (shell) |
| Denial of service via rapid storage writes | Agent-side: 1MB body limit per request (existing). Could add rate limiting later if needed. |

## Acceptance Criteria

- [ ] Iframe can `postMessage({type: 'yourbro-storage', action: 'set', ...})` and receive response
- [ ] Iframe can get, set, delete, list storage keys scoped to its page slug
- [ ] All storage requests go through E2E encrypted relay (no plaintext)
- [ ] Shell ignores postMessage from sources other than its iframe
- [ ] Shell hardcodes slug — iframe can't write to other pages' storage
- [ ] SKILL.md documents the postMessage API with copy-paste examples
- [ ] Demo page at `/p/mehanig/test` uses storage to persist state across page loads

## Files to create/modify

| File | Action |
|------|--------|
| `agent/internal/handlers/page_storage.go` | **Create** — new handler for page storage endpoints |
| `agent/cmd/server/main.go` | **Modify** — register `/api/page-storage/*` routes |
| `web/public/p/shell.html` | **Modify** — add postMessage listener + E2E relay bridge |
| `skill/SKILL.md` | **Modify** — document postMessage storage API |
| `CLAUDE.md` | **Modify** — add note about iframe storage bridge |

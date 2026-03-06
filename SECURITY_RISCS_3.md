# Security Risk: iframe with allow-scripts + allow-same-origin

## Status: Accepted (for now)

## Context

Page content is rendered in an iframe inside `shell.html` on `yourbro.ai`. The shell enriches `index.html` with meta tags and SDK, caches the enriched bundle in a Service Worker, then sets `iframe.src = "/p/assets/{slug}/index.html"`. The SW serves the cached files.

The iframe uses `sandbox="allow-scripts allow-same-origin"` — `allow-same-origin` is required so the iframe can use the parent page's Service Worker to load sub-resources (JS, CSS).

## Risk

Since the iframe loads from the same origin (`yourbro.ai` via SW), combining `allow-scripts` + `allow-same-origin` effectively **negates the sandbox**:

1. **IndexedDB access**: Iframe JS can read `clawd-keys` IndexedDB store and exfiltrate Ed25519 private keys
2. **Cookie access**: Iframe JS can make same-origin fetch requests with credentials
3. **Parent DOM access**: Iframe JS can access `parent.document` since it's same-origin
4. **Sandbox escape**: Iframe JS can create a new iframe without sandbox attributes, fully escaping the sandbox

MDN explicitly warns: "it is strongly discouraged to use both allow-scripts and allow-same-origin" when content is same-origin.

## Why accepted

- Page content comes from the user's own agent running on their own machine
- Content is written by ClawdBot (the user's AI assistant)
- The trust boundary is the agent itself — if the agent is compromised, there are bigger problems
- Page bundles are E2E encrypted in transit (X25519 ECDH + AES-256-GCM) — the relay server cannot read or inject content

## Mitigation options (future)

1. **Double iframe on sandbox subdomain**: Serve the outer iframe from a different origin (e.g. `pages.yourbro.ai`) so `allow-same-origin` grants access to that subdomain's storage, not `yourbro.ai`'s. More complex infrastructure.

2. **Blob URL iframe**: Use `URL.createObjectURL(new Blob([html]))` as iframe `src` instead of `srcdoc`. The blob gets a unique opaque origin, but this also means no SW access — back to square one.

## Recommendation

Option 1 (sandbox subdomain) is the best path forward if tighter isolation is needed — it preserves the multi-file SW architecture while isolating page content from `yourbro.ai` storage. The tradeoff is DNS/infrastructure complexity and needing to relay keypairs cross-origin.

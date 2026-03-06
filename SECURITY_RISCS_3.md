# Security Risk: srcdoc iframe with allow-scripts + allow-same-origin

## Status: Accepted (for now)

## Context

Page content is rendered in a `srcdoc` iframe inside `shell.html` on `yourbro.ai`. The iframe sandbox was changed from `allow-scripts` to `allow-scripts allow-same-origin` to enable Service Worker asset serving — the SW intercepts fetch requests for `/p/assets/{slug}/*` and serves cached page files (JS, CSS) from the bundle.

Without `allow-same-origin`, the sandboxed iframe gets an opaque origin and cannot use the parent page's Service Worker, so `<script src="app.js">` fetches would fail.

## Risk

With `srcdoc`, the content is inherently same-origin with the parent (`yourbro.ai`). Combining `allow-scripts` + `allow-same-origin` effectively **negates the sandbox**:

1. **IndexedDB access**: Iframe JS can read `clawd-keys` IndexedDB store and exfiltrate Ed25519 private keys
2. **Cookie access**: Iframe JS can read `yb_session` httpOnly cookie (only via document.cookie if not httpOnly — but could make same-origin fetch requests with credentials)
3. **Parent DOM access**: Iframe JS can access `parent.document` since it's same-origin
4. **Sandbox escape**: Iframe JS can create a new iframe without sandbox attributes, fully escaping the sandbox

MDN explicitly warns: "it is strongly discouraged to use both allow-scripts and allow-same-origin" when content is same-origin.

## Why accepted

- Page content comes from the user's own agent running on their own machine
- Content is written by ClawdBot (the user's AI assistant)
- The trust boundary is the agent itself — if the agent is compromised, there are bigger problems
- E2E encryption ensures the relay server cannot inject malicious content

## Mitigation options (future)

1. **Inline assets into srcdoc**: Instead of SW, inject CSS as `<style>` and JS as `<script>` tags directly into the srcdoc HTML. The shell already has the full file bundle in memory. This removes the need for `allow-same-origin` entirely. Simplest fix.

2. **Double iframe on sandbox subdomain**: Serve the outer iframe from a different origin (e.g. `pages.yourbro.ai`) so `allow-same-origin` grants access to that subdomain's storage, not `yourbro.ai`'s. More complex infrastructure.

3. **Blob URL iframe**: Use `URL.createObjectURL(new Blob([html]))` as iframe `src` instead of `srcdoc`. The blob gets a unique opaque origin, but this also means no SW access — back to square one.

## Recommendation

Option 1 (inline assets) is the clear winner — it's simpler, removes the SW entirely for asset serving, and restores the original `sandbox="allow-scripts"` security boundary. The main tradeoff is larger srcdoc strings and no browser caching of individual assets, but page bundles are capped at 10MB and are fetched fresh on each visit anyway.

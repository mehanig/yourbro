# Security Hardening — Before Public Relay Release

Findings from security review of `feat/websocket-relay` branch (2026-03-05).
None are currently exploitable, but should be hardened before public release.

## 1. Remove `"null"` from CORS AllowedOrigins

**File:** `api/cmd/server/main.go:153`

`"null"` is in `AllowedOrigins` with `AllowCredentials: true`. Currently mitigated by `SameSite=Lax` cookies and Bearer-token-first auth, but allowing `"null"` origin globally is unnecessary — the sandboxed iframe already authenticates via `Authorization: Bearer` header extracted from URL params.

**Fix:** Remove `"null"` from `AllowedOrigins`. Verify sandboxed iframe relay requests still work (they should — they use Bearer tokens, not cookies).

## 2. Validate `relay:` agent ownership at page creation

**File:** `api/internal/handlers/pages.go:53-55`

When creating a page with `agent_endpoint: "relay:{agent_id}"`, the agent ID is stored without checking that the authenticated user owns that agent. Currently mitigated by ownership check at relay request time (both "not found" and "not owned" return same 404 error).

**Fix:** At page creation, parse the agent ID from `relay:` prefix and verify it belongs to the authenticated user. Fail early with 400.

## 3. Restore stricter CSP for page content iframe

**File:** `api/internal/handlers/pages.go:182`

CSP was downgraded from nonce-based to `script-src 'unsafe-inline'` for the sandboxed page content iframe. Currently mitigated by server-side ownership gate (`claims.UserID != page.UserID` -> 403) and iframe sandbox (no `allow-same-origin`). Self-XSS in own pages is not exploitable.

**Fix:** Use hash-based CSP (`script-src 'sha256-...'`) for the SDK script computed at build time, keeping user HTML restricted. Alternatively, sanitize user HTML server-side before rendering.

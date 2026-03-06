# Security Issues to Fix Before Public Release

Audit date: 2026-03-05

## CRITICAL

### 1. Hardcoded database credentials in docker-compose.yml
- `POSTGRES_USER: yourbro`, `POSTGRES_PASSWORD: yourbro` hardcoded in plain text
- Production compose uses `${POSTGRES_PASSWORD:-yourbro}` which defaults to `yourbro` if env var missing
- **Fix**: Move all secrets to `.env` files (gitignored), remove defaults from compose files

### 2. XSS via innerHTML in dashboard.ts
- Agent names, page titles/slugs, token names, endpoints interpolated directly into `innerHTML` without escaping
- A malicious agent name like `<img src=x onerror=alert(1)>` would execute JavaScript
- Affects: `renderAgentsList()`, page list, token list
- Combined with IndexedDB keypair access, attacker could steal signing keys and impersonate user
- **Fix**: Create shared `escapeHtml()` utility, escape all user content before innerHTML insertion

## HIGH

### 3. JWT secret management
- `JWT_SECRET` loaded from env with no minimum length or complexity validation
- **Fix**: Validate JWT_SECRET minimum length on startup, fail loudly if weak or unset

### 4. No CSRF protection
- Logout and state-changing POST endpoints don't verify CSRF tokens
- Cookie-based auth makes this exploitable
- **Fix**: Add CSRF tokens for state-changing requests

### 5. OAuth state parameter
- Verify Google OAuth flow validates `state` parameter to prevent CSRF on callback
- **Fix**: Audit and ensure state validation exists

### 6. Agent pairing code entropy
- Verify pairing codes have sufficient entropy and short expiry to prevent brute-force
- **Fix**: Audit pairing code generation, ensure expiry and rate limiting

## MEDIUM

### 7. No rate limiting
- API endpoints (login, pairing, token creation) have no rate limiting
- **Fix**: Add rate limiting middleware to Go API

### 8. SSE auth via query param fallback
- EventSource can't set headers, so SSE falls back to query param auth
- Tokens in URLs get logged by proxies/servers
- **Fix**: Already mitigated by cookie-based auth; verify no token leakage in logs

### 9. Missing security headers in nginx
- No `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`
- **Fix**: Add security headers to nginx config

### 10. Browser keypair exposure via XSS
- X25519 private key stored in IndexedDB; if XSS achieved (#2), attacker can extract keypair
- **Fix**: Fixing #2 (XSS) is the primary mitigation

## LOW

### 11. Docker runs as root
- Dockerfile doesn't specify non-root USER for runtime stage
- **Fix**: Add `USER nobody` to runtime stage

### 12. No TLS certificate pinning
- Agent communication relies on standard TLS
- **Fix**: Consider certificate pinning for agent-to-server communication

### 13. ALLOW_HTTP_AGENT in local compose
- `ALLOW_HTTP_AGENT: "true"` set in local compose — expected for dev
- **Fix**: Ensure this is never set in production env

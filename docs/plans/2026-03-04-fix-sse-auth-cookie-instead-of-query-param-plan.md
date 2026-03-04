---
title: "fix: SSE auth via httpOnly cookie instead of query param token"
type: fix
status: active
date: 2026-03-04
---

# fix: SSE auth via httpOnly cookie instead of query param token

## Problem Statement

The SSE endpoint `/api/agents/stream` currently requires the JWT session token as a URL query parameter:

```
/api/agents/stream?token=eyJhbGciOiJIUzI1NiIs...
```

This leaks the token in:
- Browser URL bar / developer tools Network tab
- Server access logs (nginx, Go chi logger)
- Browser history
- Proxy logs

The `EventSource` API doesn't support custom headers, so we can't pass `Authorization: Bearer ...`. The correct solution is **httpOnly cookies** — EventSource sends cookies automatically on same-origin requests.

## Proposed Solution

Set an httpOnly session cookie on login (Google OAuth callback). The auth middleware reads the cookie as a fallback. Remove the `?token=` query param approach entirely.

Since our frontend and API are **same-origin** (both behind nginx on port 80/443), cookies are sent automatically — no CORS or `withCredentials` needed.

## Changes

### 1. Set cookie on OAuth callback — `api/cmd/server/main.go:178`

After creating the session JWT, set it as an httpOnly cookie before redirecting:

```go
http.SetCookie(w, &http.Cookie{
    Name:     "yb_session",
    Value:    token,
    Path:     "/",
    HttpOnly: true,
    Secure:   domain != "",  // true in production (HTTPS), false in local dev (HTTP)
    SameSite: http.SameSiteLaxMode,
    MaxAge:   7 * 24 * 60 * 60, // 7 days, matches JWT expiry
})
```

Keep the existing redirect with `?token=` in the fragment — the frontend still needs it for localStorage (used by `fetch()` calls with Authorization header). The cookie is an additional auth channel for SSE.

### 2. Clear cookie on logout — add endpoint or handle client-side

Option A: Frontend calls a `POST /api/logout` endpoint that clears the cookie:
```go
http.SetCookie(w, &http.Cookie{
    Name:     "yb_session",
    Value:    "",
    Path:     "/",
    HttpOnly: true,
    MaxAge:   -1, // delete
})
```

Option B: Since the cookie has the same name as localStorage key, the frontend's existing `clearToken()` handles localStorage. Cookie is httpOnly so JS can't clear it — needs a server endpoint.

**Recommendation:** Add `POST /api/logout` endpoint (simple, ~10 lines).

### 3. Update auth middleware — `api/internal/middleware/auth.go:24-35`

Replace query param fallback with cookie fallback:

```go
header := r.Header.Get("Authorization")
// Fallback to httpOnly cookie for SSE (EventSource can't set headers)
if header == "" {
    if cookie, err := r.Cookie("yb_session"); err == nil {
        header = "Bearer " + cookie.Value
    }
}
```

Remove the `?token=` query param code entirely.

### 4. Update dashboard SSE — `web/src/pages/dashboard.ts:149-150`

Remove token from URL:

```typescript
// Before:
const token = localStorage.getItem("yb_session");
const evtSource = new EventSource(`/api/agents/stream?token=${encodeURIComponent(token || "")}`);

// After:
const evtSource = new EventSource("/api/agents/stream");
```

Cookie is sent automatically by the browser.

### 5. Update dashboard logout — `web/src/pages/dashboard.ts:134-138`

Add call to logout endpoint to clear cookie:

```typescript
document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    clearToken();
    window.location.hash = "#/login";
    window.location.reload();
});
```

## Acceptance Criteria

- [ ] SSE connects without token in URL — just `GET /api/agents/stream`
- [ ] Cookie set on Google OAuth callback with `HttpOnly`, `SameSite=Lax`
- [ ] Auth middleware reads cookie as fallback when no Authorization header
- [ ] `?token=` query param support removed from middleware
- [ ] Logout clears both localStorage and cookie
- [ ] Existing `Authorization: Bearer` header auth still works for API calls
- [ ] Agent heartbeat (uses `Authorization` header) unaffected

## Files to Modify

| File | Change |
|------|--------|
| `api/cmd/server/main.go` | Set cookie in OAuth callback, add `/api/logout` endpoint |
| `api/internal/middleware/auth.go` | Replace query param fallback with cookie fallback |
| `web/src/pages/dashboard.ts` | Remove token from EventSource URL, add logout fetch |
| `web/src/lib/api.ts` | No change (fetch calls still use Authorization header) |

## Context

- **Same-origin**: Frontend and API both served from nginx on same host — cookies sent automatically
- **EventSource limitation**: Can't set custom headers, but sends cookies natively
- **Security**: httpOnly prevents XSS from stealing the cookie, SameSite=Lax prevents CSRF
- **Documented learning**: `docs/solutions/integration-issues/sse-real-time-dashboard-agent-status.md` — lists query param token as a known pitfall

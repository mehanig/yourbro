---
title: "Relay Router Returns 401 Due to TLS Scheme Mismatch in RFC 9421 Signatures"
category: integration-issues
tags: [relay, httptest, rfc-9421, tls, signature-verification, ed25519]
module: agent/relay
symptom: "All relay storage requests (GET/PUT/DELETE) return 401 while POST /api/pair succeeds"
root_cause: "httptest requests have r.TLS == nil, causing auth middleware to reconstruct @target-uri with http:// instead of https://, mismatching the SDK's signature"
date: 2026-03-05
---

# Relay Router Returns 401 Due to TLS Scheme Mismatch in RFC 9421 Signatures

## Problem

After switching to relay-only mode, all agent storage requests (GET, PUT, DELETE) returned HTTP 401 Unauthorized. POST `/api/pair` continued to work (it uses pairing code auth, not RFC 9421 signatures).

Agent logs showed:

```
POST /api/pair → 200 OK
GET /api/storage/mypage/key → 401 Unauthorized
PUT /api/storage/mypage/key → 401 Unauthorized
```

## Investigation

1. The SDK signs requests per RFC 9421 with `@target-uri` = `https://relay.internal/api/storage/...`
2. The relay router (`agent/internal/relay/router.go`) creates HTTP requests with URL `https://relay.internal/...` and routes them through the chi router via `httptest.NewRecorder()`
3. The auth middleware (`agent/internal/middleware/auth.go`) reconstructs `@target-uri` by checking `r.TLS`:
   - `r.TLS != nil` → scheme = `https`
   - `r.TLS == nil` → scheme = `http`
4. `http.NewRequestWithContext()` does **not** set `r.TLS` even when the URL has an `https://` scheme
5. The middleware reconstructed `http://relay.internal/...` while the SDK signed `https://relay.internal/...` → signature base string mismatch → 401

## Root Cause

Go's `http.NewRequestWithContext` and `httptest.NewRequest` don't populate `r.TLS` from the URL scheme. The auth middleware trusts `r.TLS` (the actual connection state) over the URL scheme to determine whether the request is HTTPS. Since relay requests are synthetic (not real HTTP connections), `r.TLS` was always nil.

## Solution

Set `httpReq.TLS` to a non-nil value in the relay router before passing to the chi router:

```go
// agent/internal/relay/router.go — handleCleartextRequest()

import "crypto/tls"

// After creating httpReq:
targetURL := "https://relay.internal" + req.Path
httpReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL, bodyReader)
if err != nil { ... }

// Mark as TLS so the auth middleware reconstructs @target-uri with https://
// (matching what the SDK signed against)
httpReq.TLS = &tls.ConnectionState{}
```

## Verification

1. Rebuild agent: `docker compose ... --profile agent build agent-server`
2. Restart agent: `docker compose ... --profile agent up -d agent-server`
3. Storage requests now return 200 instead of 401

## Gotchas

- `r.TLS` is the **only** reliable way Go HTTP middleware determines scheme — `r.URL.Scheme` is often empty for server-side requests
- Any new code path that creates synthetic requests for RFC 9421-protected handlers must set `r.TLS`
- The router test (`relay/router_test.go`) should include a test that verifies TLS is set before routing

## Related

- [E2E Encrypted Relay Agent Integration](./e2e-encrypted-relay-agent-sandboxed-iframe-integration.md)
- [Incomplete Agent Key Revocation](../security-issues/incomplete-agent-key-revocation-on-removal.md)

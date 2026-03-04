---
title: "Sandboxed iframe can't load scripts or access IndexedDB — relay CryptoKey via postMessage"
category: integration-issues
tags:
  - sandboxed-iframe
  - opaque-origin
  - IndexedDB
  - WebCrypto
  - postMessage
  - CSP-nonce
  - zero-trust
module: sdk-iframe
symptom: >
  SDK script fails to load inside sandboxed iframe. IndexedDB throws SecurityError.
  Ed25519 keypair is unreachable from the iframe context.
root_cause: >
  sandbox="allow-scripts" without allow-same-origin forces an opaque origin.
  Opaque origins cannot access IndexedDB, localStorage, or load scripts from
  the parent origin. No server-side configuration can override this.
date: 2026-03-04
---

# Sandboxed iframe can't load scripts or access IndexedDB

## Symptom

Pages with agent endpoints render in a sandboxed iframe (`sandbox="allow-scripts"`). The SDK needs to sign every storage request with the user's Ed25519 private key, but:

1. `<script src="/sdk/clawd-storage.js">` is blocked — the iframe can't fetch from the parent origin
2. `indexedDB.open()` throws `SecurityError` — opaque origin has no storage access
3. The keypair (stored in IndexedDB by the dashboard pairing flow) is unreachable

## Root Cause

The `sandbox` attribute without `allow-same-origin` forces the iframe into an **opaque origin** (`null`). This is by design — it isolates user-authored HTML from the host page's cookies, localStorage, and session tokens.

But opaque origins are excluded from all storage APIs (IndexedDB, localStorage, Cache API) by the browser security model. No CORS headers or server configuration can override this — it's enforced at the renderer process level.

## Solution

Three-part fix: inline the SDK, use CSP nonces, and relay the keypair via `postMessage`.

### 1. Bundle SDK as IIFE and inline it

Build the SDK as a self-executing bundle with esbuild:

```json
"build": "tsc && esbuild src/index.ts --bundle --format=iife --target=es2022 --outfile=dist/clawd-storage.js"
```

The Go server reads the bundle at startup and embeds it directly into page HTML:

```go
// api/cmd/server/main.go
sdkScript := ""
if sdkData, err := staticFiles.ReadFile("static/sdk/clawd-storage.js"); err == nil {
    sdkScript = string(sdkData)
}
```

### 2. Generate per-request CSP nonce

Each page render generates a fresh nonce. Only scripts with this nonce execute:

```go
// api/internal/handlers/pages.go
nonceBytes := make([]byte, 16)
rand.Read(nonceBytes)
cspNonce := base64.StdEncoding.EncodeToString(nonceBytes)

csp := fmt.Sprintf(
    "default-src 'self' https:; script-src 'nonce-%s'; ...",
    cspNonce,
)

metaTags = fmt.Sprintf(
    `<meta name="clawd-agent-endpoint" content="%s">`+"\n"+
    `<meta name="clawd-page-slug" content="%s">`+"\n"+
    `<script nonce="%s">%s</script>`,
    template.HTMLEscapeString(*page.AgentEndpoint),
    template.HTMLEscapeString(page.Slug),
    cspNonce,
    h.SDKScript,
)
```

User-authored `<script>` tags also get the nonce via `addNonceToScripts()`.

### 3. Parent relays CryptoKey via postMessage

The parent page (not sandboxed) loads the keypair from IndexedDB and sends it to the iframe after load:

```javascript
// In pageHostTemplate (parent page)
iframe.addEventListener('load', function() {
    iframe.contentWindow.postMessage({
        type: 'clawd-keypair',
        privateKey: kp.privateKey,       // CryptoKey object
        publicKeyBytes: kp.publicKeyBytes // Uint8Array
    }, '*');
});
```

The SDK inside the iframe listens for the message:

```typescript
// sdk/src/index.ts
function waitForKeypair(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    window.addEventListener("message", function handler(event) {
      if (event.data?.type === "clawd-keypair") {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        resolve({
          privateKey: event.data.privateKey,
          publicKeyBytes: event.data.publicKeyBytes,
        });
      }
    });
  });
}
```

## Key Insight

**CryptoKey objects are structured-cloneable regardless of the `extractable` flag.** The `extractable: false` flag only prevents `crypto.subtle.exportKey()` — it does NOT prevent structured clone via `postMessage`. This means a non-extractable private key can be relayed from parent to sandboxed iframe without ever exposing raw key bytes. The iframe can use it for signing but cannot extract the key material.

## Prevention

- **Sandboxed iframes are stateless compute** — never expect them to persist data. The parent must manage all storage and relay what the iframe needs.
- **Test storage API access early** — attempt `indexedDB.open()`, `localStorage`, etc. from within the sandbox during development.
- **Use `postMessage` with typed message schemas** — define a `type` field to distinguish messages and avoid collisions with other listeners.
- **CSP nonces over `unsafe-inline`** — per-request nonces ensure only server-generated scripts execute, even inside the sandbox.

## Related

- [MDN: sandbox attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox)
- [W3C: CryptoKey structured clone](https://www.w3.org/TR/WebCryptoAPI/#cryptokey-interface)
- [RFC 9421: HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421)

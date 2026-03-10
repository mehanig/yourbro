# Crowdgent Relay Protocol Specification


**Version:** 1.0-draft
**Status:** Specification + shared types (no gateway/crowdgent implementation yet)

## Overview

The Crowdgent relay protocol enables direct communication between yourbro crowdgents through the existing API gateway. All traffic is end-to-end encrypted — the gateway relays opaque blobs without access to content.

**Use case:** Live content sharing. An Owner Crowdgent generates content, a Viewer Crowdgent proxies it to a browser. Both crowdgents must be online.

```
Browser <-> Viewer Crowdgent <--[E2E relay]--> Owner Crowdgent <-> Live Data
             (display)          (encrypted)        (generates)
```

## Wire Format

### WireMessage Envelope

All WebSocket communication uses a common envelope:

```json
{
  "v": 1,
  "type": "request" | "response" | "crowdgent_request",
  "id": "<request-uuid>",
  "payload": { ... }
}
```

- `v` — protocol version (currently `1`)
- `type` — message type. `"crowdgent_request"` is new for Crowdgent relay
- `id` — unique request identifier, used to correlate responses
- `payload` — type-specific payload (see below)

### RelayRequest

Payload for `"request"` and inner content of Crowdgent messages (after decryption):

```json
{
  "id": "<request-uuid>",
  "method": "GET",
  "path": "/api/pages",
  "headers": { "Content-Type": "application/json" },
  "body": "<base64-encoded-body>",
  "encrypted": true,
  "payload": "<base64(nonce12 + AES-GCM-ciphertext)>",
  "key_id": "<base64url-X25519-public-key>"
}
```

When `encrypted` is `true`, the `method`/`path`/`headers`/`body` fields are absent — the actual request is inside the encrypted `payload`.

### RelayResponse

Payload for `"response"` type:

```json
{
  "id": "<request-uuid>",
  "status": 200,
  "headers": { "Content-Type": "application/json" },
  "body": "<response-body>",
  "encrypted": true,
  "payload": "<base64(nonce12 + AES-GCM-ciphertext)>"
}

```

When `encrypted` is `true`, `status`/`headers`/`body` are absent — the actual response is inside the encrypted `payload`.

### CrowdgentRelayRequest

Payload for `"crowdgent_request"` type:

```json
{
  "id": "<request-uuid>",
  "from_crowdgent": "<source-crowdgent-uuid>",
  "encrypted": true,
  "key_id": "<base64url-source-crowdgent-X25519-pubkey>",
  "payload": "<base64(nonce12 + AES-GCM-ciphertext)>"
}
```

The encrypted inner payload, once decrypted, is a standard `RelayRequest`.

## Cryptographic Primitives

### Key Exchange: X25519 ECDH

Each crowdgent generates a persistent X25519 key pair. The public key is registered with the gateway during WebSocket connection (`x25519_pub` query parameter).

### Key Derivation: HKDF-SHA256

```
shared_secret = X25519(local_private, remote_public)
aes_key = HKDF-SHA256(
    ikm:  shared_secret,
    salt: nil,
    info: "yourbro-e2e-v1",
    len:  32
)
```

### Encryption: AES-256-GCM

```
nonce = random(12 bytes)
ciphertext = AES-256-GCM-Seal(aes_key, nonce, plaintext, nil)
output = nonce || ciphertext   // 12 + len(plaintext) + 16 bytes
```

The output is base64-encoded for transport in JSON `payload` fields.

## Discovery

### Existing: Page-Based Discovery

```
GET /api/public-page/{username}/{slug}
→ { "crowdgent_uuid": "...", "x25519_public": "<base64>" }
```

Returns the UUID and X25519 public key of the first online crowdgent for the given user. No authentication required. CDN-cacheable.

### Future: Direct Crowdgent Discovery

```
GET /api/crowdgent-info/{crowdgent_uuid}
→ { "crowdgent_uuid": "...", "x25519_public": "<base64>", "is_online": true }
```

Public, no auth. Returns crowdgent info by UUID.

## Request/Response Flow

### Crowdgent Relay

```
Source Crowdgent               API Hub                Target Crowdgent
     |                            |                            |
     |-- POST /api/cgr/{target} ->|                            |
     |   {encrypted, key_id,      |                            |
     |    payload}                 |                            |
     |                            |-- WireMessage ------------->|
     |                            |   type: "crowdgent_request"|
     |                            |                            |
     |                            |<-- WireMessage ------------|
     |                            |   type: "response"         |
     |                            |                            |
     |<-- HTTP 200 {encrypted} ---|                            |
```

1. Source crowdgent makes HTTP POST to `POST /api/cgr/{target_uuid}` with bearer token
2. Gateway wraps in `WireMessage` with `type: "crowdgent_request"` and forwards via WebSocket
3. Target crowdgent decrypts, routes through its handler, encrypts response
4. Gateway returns encrypted response as HTTP response to source crowdgent

### Viewer Crowdgent Pattern (Browser Integration)

```
Browser              Viewer Crowdgent          Owner Crowdgent
   |                          |                          |
   |-- encrypted request ---->|                          |
   |   (browser→viewer E2E)   |                          |
   |                          |-- Crowdgent relay ------>|
   |                          |   (viewer→owner E2E)     |
   |                          |                          |
   |                          |<-- Crowdgent response ---|
   |                          |   (owner→viewer E2E)     |
   |                          |                          |
   |<-- encrypted response ---|                          |
   |   (viewer→browser E2E)   |                          |
```

Two separate E2E encryption layers: browser↔viewer and viewer↔owner.

## Authorization Model

### Gateway Level

- Source crowdgent must be authenticated (valid bearer token)
- No ownership check — any authenticated crowdgent can send to any other online crowdgent
- Rate limiting per source crowdgent (recommended)

### Target Crowdgent Level

- Authorization is determined by `key_id` (source crowdgent's X25519 public key)
- If `key_id` matches a paired user in `authorized_keys` → full access (all pages)
- If `key_id` is unknown → public pages only (`public: true`)
- No explicit crowdgent-to-crowdgent pairing required

**"Decryption success = authentication."** If the target crowdgent can decrypt the payload and the `key_id` resolves, that's proof of identity.

## Error Handling

### Gateway Errors (HTTP status codes)

| Status | Meaning |
|--------|---------|
| 401 | Source crowdgent not authenticated |
| 404 | Target crowdgent not found |
| 503 | Target crowdgent offline |
| 504 | Timeout (10s default) |

### Crowdgent Errors (inside encrypted response)

Standard HTTP status codes in the `RelayResponse.status` field. These are opaque to the gateway.

## Security Considerations

1. **Zero-knowledge gateway**: The gateway never sees plaintext content. It routes encrypted blobs by crowdgent UUID.

2. **Authenticated encryption**: AES-256-GCM provides both confidentiality and integrity. Tampered ciphertexts are rejected.

3. **No fan-out**: The protocol is strictly 1:1 request/response. No broadcast or multicast.

4. **Rate limiting**: The gateway should rate-limit Crowdgent relay calls per source crowdgent to prevent abuse.

5. **Key rotation**: Crowdgents can rotate X25519 keys by reconnecting with a new `x25519_pub`. In-flight requests using the old key will fail decryption gracefully.

6. **No replay protection at protocol level**: AES-GCM nonces are random (not sequential), so the protocol does not prevent replays. Applications should implement their own replay protection if needed (e.g., request IDs, timestamps).

7. **Trust model**: Knowing a crowdgent's UUID + X25519 public key is sufficient to send it encrypted messages. This is equivalent to the existing anonymous browser access model.

// Package crowdgent defines types and cryptographic primitives for
// crowdgent-to-crowdgent communication over the Crowdgent relay protocol.
package crowdgent

// CrowdgentRelayRequest is the payload for crowdgent-to-crowdgent relay messages.
// Sent via POST /api/cgr/{target_uuid} and delivered as a WireMessage
// with type "crowdgent_request".
type CrowdgentRelayRequest struct {
	ID            string `json:"id"`
	FromCrowdgent string `json:"from_crowdgent"`
	Encrypted     bool   `json:"encrypted"`
	KeyID         string `json:"key_id"`  // base64url X25519 public key of source crowdgent
	Payload       string `json:"payload"` // base64(nonce12 + AES-GCM ciphertext)
}

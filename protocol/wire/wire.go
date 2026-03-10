// Package wire defines the WebSocket wire protocol types shared between
// the API gateway and crowdgents.
package wire

import "encoding/json"

// Message is the WebSocket wire protocol envelope.
type Message struct {
	Version int             `json:"v"`
	Type    string          `json:"type"` // "request", "response", "crowdgent_request"
	ID      string          `json:"id"`
	Payload json.RawMessage `json:"payload"`
}

// RelayRequest is the relay request payload (gateway → crowdgent or crowdgent → crowdgent).
type RelayRequest struct {
	ID        string            `json:"id"`
	Method    string            `json:"method,omitempty"`
	Path      string            `json:"path,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Body      *string           `json:"body,omitempty"`
	Encrypted bool              `json:"encrypted,omitempty"`
	Payload   string            `json:"payload,omitempty"` // base64 of IV + AES-GCM ciphertext
	KeyID     string            `json:"key_id,omitempty"`  // base64url X25519 public key of sender
}

// RelayResponse is the relay response payload (crowdgent → gateway or crowdgent → crowdgent).
type RelayResponse struct {
	ID        string            `json:"id"`
	Status    int               `json:"status,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Body      *string           `json:"body,omitempty"`
	Encrypted bool              `json:"encrypted,omitempty"`
	Payload   string            `json:"payload,omitempty"` // base64 of IV + AES-GCM ciphertext
}

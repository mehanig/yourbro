package models

import (
	"encoding/json"
	"time"
)

type User struct {
	ID        int64     `json:"id"`
	GoogleID  string    `json:"google_id"`
	Email     string    `json:"email"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
}

type Token struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	TokenHash string    `json:"-"`
	Name      string    `json:"name"`
	Scopes    []string  `json:"scopes"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type PublicKey struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Name      string    `json:"name"`
	PublicKey string    `json:"public_key"`
	CreatedAt time.Time `json:"created_at"`
}

type Agent struct {
	ID       int64     `json:"id"`
	UserID   int64     `json:"user_id"`
	Name     string    `json:"name"`
	PairedAt time.Time `json:"paired_at"`
	IsOnline bool      `json:"is_online"`
}

// API request/response types

type CreatePublicKeyRequest struct {
	Name      string `json:"name"`
	PublicKey string `json:"public_key"`
}

type CreateTokenRequest struct {
	Name      string   `json:"name"`
	Scopes    []string `json:"scopes"`
	ExpiresIn int      `json:"expires_in_days"`
}

type CreateTokenResponse struct {
	Token string `json:"token"`
	Name  string `json:"name"`
	ID    int64  `json:"id"`
}

type RegisterAgentRequest struct {
	Name string `json:"name"`
}

type RelayRequest struct {
	ID        string            `json:"id"`
	Method    string            `json:"method,omitempty"`
	Path      string            `json:"path,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Body      *string           `json:"body,omitempty"`
	Encrypted bool              `json:"encrypted,omitempty"`
	Payload   string            `json:"payload,omitempty"` // base64 of IV + AES-GCM ciphertext
}

type RelayResponse struct {
	ID        string            `json:"id"`
	Status    int               `json:"status,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Body      *string           `json:"body,omitempty"`
	Encrypted bool              `json:"encrypted,omitempty"`
	Payload   string            `json:"payload,omitempty"` // base64 of IV + AES-GCM ciphertext
}

// WireMessage is the WebSocket wire protocol envelope.
type WireMessage struct {
	Version int    `json:"v"`
	Type    string `json:"type"` // "request" or "response"
	ID      string `json:"id"`
	Payload json.RawMessage `json:"payload"`
}

type OAuthCallbackResponse struct {
	SessionToken string `json:"session_token"`
	User         User   `json:"user"`
}

// ValidScopes defines allowed token scopes.
var ValidScopes = map[string]bool{
	"publish:pages": true,
	"read:pages":    true,
	"manage:keys":   true,
}

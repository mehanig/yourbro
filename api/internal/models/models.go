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

type Page struct {
	ID            int64     `json:"id"`
	UserID        int64     `json:"user_id"`
	Slug          string    `json:"slug"`
	Title         string    `json:"title"`
	HTMLContent   string    `json:"html_content,omitempty"`
	AgentEndpoint *string   `json:"agent_endpoint,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type PublicKey struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Name      string    `json:"name"`
	PublicKey string    `json:"public_key"`
	CreatedAt time.Time `json:"created_at"`
}

type Agent struct {
	ID            int64      `json:"id"`
	UserID        int64      `json:"user_id"`
	Name          string     `json:"name"`
	Endpoint      *string    `json:"endpoint"`
	LastHeartbeat *time.Time `json:"last_heartbeat"`
	PairedAt      time.Time  `json:"paired_at"`
	IsOnline      bool       `json:"is_online"`
}

// API request/response types

type CreatePageRequest struct {
	Slug          string `json:"slug"`
	Title         string `json:"title"`
	HTMLContent   string `json:"html_content"`
	AgentEndpoint string `json:"agent_endpoint,omitempty"`
}

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
	Endpoint string `json:"endpoint"`
	Name     string `json:"name"`
}

type RelayRequest struct {
	ID      string            `json:"id"`
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    *string           `json:"body"`
}

type RelayResponse struct {
	ID      string            `json:"id"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    *string           `json:"body"`
}

// WireMessage is the WebSocket wire protocol envelope.
type WireMessage struct {
	Version int    `json:"v"`
	Type    string `json:"type"` // "request" or "response"
	ID      string `json:"id"`
	Payload json.RawMessage `json:"payload"`
}

type HeartbeatRequest struct {
	Endpoint string `json:"endpoint"`
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

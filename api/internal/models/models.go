package models

import (
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
	ID            string    `json:"id"`        // UUID string — primary public identifier
	DBId          int64     `json:"-"`         // internal BIGSERIAL, never exposed via API
	UserID        int64     `json:"user_id,omitempty"`
	Name          string    `json:"name"`
	PairedAt      time.Time `json:"paired_at"`
	IsOnline      bool      `json:"is_online"`
	X25519PubKey  []byte    `json:"-"`         // agent's X25519 public key for E2E encryption
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
	UUID string `json:"uuid"`
}

type OAuthCallbackResponse struct {
	SessionToken string `json:"session_token"`
	User         User   `json:"user"`
}

// PageAnalytics holds aggregated analytics for a single page.
type PageAnalytics struct {
	Slug           string     `json:"slug"`
	TotalViews     int64      `json:"total_views"`
	UniqueVisitors int64      `json:"unique_visitors_30d"`
	LastViewedAt   *time.Time `json:"last_viewed_at,omitempty"`
	TopReferrers   []Referrer `json:"top_referrers,omitempty"`
}

// Referrer is a referrer source with its view count.
type Referrer struct {
	Source string `json:"source"`
	Count  int64  `json:"count"`
}

// PageDetailedAnalytics holds full analytics for a single page (used by modal).
type PageDetailedAnalytics struct {
	Slug           string         `json:"slug"`
	TotalViews     int64          `json:"total_views"`
	UniqueVisitors int64          `json:"unique_visitors_30d"`
	LastViewedAt   *time.Time     `json:"last_viewed_at,omitempty"`
	DailyViews     []DailyView    `json:"daily_views"`
	TopReferrers   []Referrer     `json:"top_referrers"`
}

// DailyView holds view counts for a single day.
type DailyView struct {
	Date         string `json:"date"` // YYYY-MM-DD
	Views        int64  `json:"views"`
	UniqueViews  int64  `json:"unique_views"`
}

// CustomDomain represents a user's custom domain for page serving.
type CustomDomain struct {
	ID                int64      `json:"id"`
	UserID            int64      `json:"user_id,omitempty"`
	Domain            string     `json:"domain"`
	Verified          bool       `json:"verified"`
	VerificationToken string     `json:"verification_token,omitempty"`
	TLSProvisioned    bool       `json:"tls_provisioned"`
	DefaultSlug       string     `json:"default_slug"`
	CFHostnameID      string     `json:"-"`
	CreatedAt         time.Time  `json:"created_at"`
	VerifiedAt        *time.Time `json:"verified_at,omitempty"`
}

// ValidScopes defines allowed token scopes.
var ValidScopes = map[string]bool{
	"manage:keys": true,
}

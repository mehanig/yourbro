package identity

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims are the identity token claims verified by the agent.
type Claims struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// Verifier fetches the API's Ed25519 public key via JWKS and verifies identity tokens.
type Verifier struct {
	serverURL string
	mu        sync.RWMutex
	publicKey ed25519.PublicKey
	kid       string
	fetchedAt time.Time
}

// NewVerifier creates a verifier that fetches JWKS from the given server URL.
// It fetches the key immediately and returns an error only if the initial fetch fails.
func NewVerifier(serverURL string) (*Verifier, error) {
	v := &Verifier{serverURL: serverURL}
	if err := v.fetchJWKS(); err != nil {
		return nil, fmt.Errorf("initial JWKS fetch: %w", err)
	}
	// Refresh in background every 24h
	go v.refreshLoop()
	return v, nil
}

// Verify parses and validates an Ed25519-signed identity token.
// Returns claims on success, error otherwise.
func (v *Verifier) Verify(tokenStr string) (*Claims, error) {
	v.mu.RLock()
	pubKey := v.publicKey
	v.mu.RUnlock()

	if pubKey == nil {
		return nil, fmt.Errorf("no public key available")
	}

	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if t.Method.Alg() != "EdDSA" {
			return nil, fmt.Errorf("unexpected signing method: %s", t.Method.Alg())
		}
		return pubKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("token validation: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	if claims.Issuer != "yourbro" {
		return nil, fmt.Errorf("unexpected issuer: %s", claims.Issuer)
	}

	return claims, nil
}

type jwksResponse struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
}

func (v *Verifier) fetchJWKS() error {
	url := v.serverURL + "/.well-known/jwks.json"
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("decode JWKS: %w", err)
	}

	for _, key := range jwks.Keys {
		if key.Kty == "OKP" && key.Crv == "Ed25519" && key.Alg == "EdDSA" {
			pubBytes, err := base64.RawURLEncoding.DecodeString(key.X)
			if err != nil || len(pubBytes) != ed25519.PublicKeySize {
				continue
			}
			v.mu.Lock()
			v.publicKey = ed25519.PublicKey(pubBytes)
			v.kid = key.Kid
			v.fetchedAt = time.Now()
			v.mu.Unlock()
			log.Printf("JWKS: loaded Ed25519 public key (kid=%s)", key.Kid)
			return nil
		}
	}

	return fmt.Errorf("no Ed25519 key found in JWKS")
}

func (v *Verifier) refreshLoop() {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		if err := v.fetchJWKS(); err != nil {
			log.Printf("JWKS refresh failed: %v", err)
		}
	}
}

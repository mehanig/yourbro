package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// IdentitySigner signs short-lived identity tokens with Ed25519.
// These tokens prove a user's Google-verified email to agents via E2E encrypted relay.
// The API holds the private key; agents verify with the public key from JWKS.
type IdentitySigner struct {
	PrivateKey ed25519.PrivateKey
	PublicKey  ed25519.PublicKey
	KeyID      string // base64url of first 8 bytes of public key
}

// IdentityClaims are JWT claims for identity tokens sent to agents.
type IdentityClaims struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// NewIdentitySigner creates a signer from a base64-encoded Ed25519 private key.
// Returns nil (not error) if the key is not configured — identity tokens are optional.
func NewIdentitySigner(keyB64 string) (*IdentitySigner, error) {
	if keyB64 == "" {
		return nil, nil
	}
	keyBytes, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil || len(keyBytes) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid IDENTITY_SIGNING_KEY: expected %d base64-encoded bytes", ed25519.PrivateKeySize)
	}
	priv := ed25519.PrivateKey(keyBytes)
	pub := priv.Public().(ed25519.PublicKey)
	kid := base64.RawURLEncoding.EncodeToString(pub[:8])
	return &IdentitySigner{PrivateKey: priv, PublicKey: pub, KeyID: kid}, nil
}

// SignIdentityToken creates a 5-minute Ed25519-signed JWT with the user's email.
func (s *IdentitySigner) SignIdentityToken(email, username string, userID int64) (string, error) {
	now := time.Now()
	claims := IdentityClaims{
		Email:    email,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   fmt.Sprintf("%d", userID),
			Issuer:    "yourbro",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = s.KeyID
	return token.SignedString(s.PrivateKey)
}

// PublicKeyBytes returns the raw 32-byte Ed25519 public key.
func (s *IdentitySigner) PublicKeyBytes() []byte {
	return []byte(s.PublicKey)
}

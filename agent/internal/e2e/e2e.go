// Package e2e provides ECDH + HKDF + AES-256-GCM encryption for relay messages.
// It delegates to protocol/crowdgent for the actual implementation.
package e2e

import (
	"crypto/ecdh"

	"github.com/mehanig/yourbro/protocol/crowdgent"
)

// Cipher handles E2E encryption/decryption for a specific user.
type Cipher = crowdgent.Cipher

// NewCipher derives an AES-256-GCM key from ECDH shared secret.
func NewCipher(agentPriv *ecdh.PrivateKey, userPub *ecdh.PublicKey) (*Cipher, error) {
	return crowdgent.NewCipher(agentPriv, userPub)
}

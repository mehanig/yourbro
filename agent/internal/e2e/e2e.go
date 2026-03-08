// Package e2e provides ECDH + HKDF + AES-256-GCM encryption for relay messages.
package e2e

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"

	"golang.org/x/crypto/hkdf"
)

const hkdfInfo = "yourbro-e2e-v1"

// Cipher handles E2E encryption/decryption for a specific user.
type Cipher struct {
	aead cipher.AEAD
}

// NewCipher derives an AES-256-GCM key from ECDH shared secret.
func NewCipher(agentPriv *ecdh.PrivateKey, userPub *ecdh.PublicKey) (*Cipher, error) {
	shared, err := agentPriv.ECDH(userPub)
	if err != nil {
		return nil, fmt.Errorf("ecdh: %w", err)
	}

	// HKDF-SHA256 with zero salt (per-session salt would require negotiation)
	hkdfReader := hkdf.New(sha256.New, shared, nil, []byte(hkdfInfo))
	aesKey := make([]byte, 32)
	if _, err := io.ReadFull(hkdfReader, aesKey); err != nil {
		return nil, fmt.Errorf("hkdf: %w", err)
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, fmt.Errorf("aes: %w", err)
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm: %w", err)
	}

	return &Cipher{aead: aead}, nil
}

// Encrypt encrypts plaintext with AES-256-GCM. Returns IV(12) + ciphertext.
func (c *Cipher) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize()) // 12 bytes
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return c.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt decrypts data produced by Encrypt (IV(12) + ciphertext).
func (c *Cipher) Decrypt(data []byte) ([]byte, error) {
	if len(data) < c.aead.NonceSize() {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce := data[:c.aead.NonceSize()]
	ciphertext := data[c.aead.NonceSize():]
	return c.aead.Open(nil, nonce, ciphertext, nil)
}


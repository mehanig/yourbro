package crowdgent

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

// HKDFInfo is the info string used for HKDF key derivation.
const HKDFInfo = "yourbro-e2e-v1"

// Cipher handles E2E encryption/decryption using X25519 ECDH + HKDF + AES-256-GCM.
type Cipher struct {
	aead cipher.AEAD
}

// NewCipher derives an AES-256-GCM key from an X25519 ECDH shared secret.
// privKey is the local private key, pubKey is the remote public key.
func NewCipher(privKey *ecdh.PrivateKey, pubKey *ecdh.PublicKey) (*Cipher, error) {
	shared, err := privKey.ECDH(pubKey)
	if err != nil {
		return nil, fmt.Errorf("ecdh: %w", err)
	}

	// HKDF-SHA256 with zero salt
	hkdfReader := hkdf.New(sha256.New, shared, nil, []byte(HKDFInfo))
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

// Encrypt encrypts plaintext with AES-256-GCM. Returns nonce(12) || ciphertext.
func (c *Cipher) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize()) // 12 bytes
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return c.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt decrypts data produced by Encrypt (nonce(12) || ciphertext).
func (c *Cipher) Decrypt(data []byte) ([]byte, error) {
	if len(data) < c.aead.NonceSize() {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce := data[:c.aead.NonceSize()]
	ciphertext := data[c.aead.NonceSize():]
	return c.aead.Open(nil, nonce, ciphertext, nil)
}

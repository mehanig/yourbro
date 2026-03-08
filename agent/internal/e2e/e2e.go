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
	"sync"

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

// lruEntry is a doubly-linked list node for LRU eviction.
type lruEntry struct {
	key    string
	cipher *Cipher
	prev   *lruEntry
	next   *lruEntry
}

// CipherCache caches Cipher instances per user public key with LRU eviction.
type CipherCache struct {
	mu        sync.Mutex
	entries   map[string]*lruEntry
	head      *lruEntry // most recently used
	tail      *lruEntry // least recently used
	agentPriv *ecdh.PrivateKey
	maxSize   int
}

// NewCipherCache creates a cache of ciphers keyed by user X25519 public key.
func NewCipherCache(agentPriv *ecdh.PrivateKey) *CipherCache {
	return &CipherCache{
		entries:   make(map[string]*lruEntry),
		agentPriv: agentPriv,
		maxSize:   10000,
	}
}

// Get returns or creates a Cipher for the given user X25519 public key.
func (cc *CipherCache) Get(userX25519Pub *ecdh.PublicKey) (*Cipher, error) {
	key := string(userX25519Pub.Bytes())

	cc.mu.Lock()
	defer cc.mu.Unlock()

	if e, ok := cc.entries[key]; ok {
		cc.moveToFront(e)
		return e.cipher, nil
	}

	c, err := NewCipher(cc.agentPriv, userX25519Pub)
	if err != nil {
		return nil, err
	}

	e := &lruEntry{key: key, cipher: c}
	cc.entries[key] = e
	cc.pushFront(e)

	// Evict oldest if over capacity
	for len(cc.entries) > cc.maxSize {
		cc.removeTail()
	}

	return c, nil
}

func (cc *CipherCache) pushFront(e *lruEntry) {
	e.prev = nil
	e.next = cc.head
	if cc.head != nil {
		cc.head.prev = e
	}
	cc.head = e
	if cc.tail == nil {
		cc.tail = e
	}
}

func (cc *CipherCache) moveToFront(e *lruEntry) {
	if e == cc.head {
		return
	}
	// Unlink
	if e.prev != nil {
		e.prev.next = e.next
	}
	if e.next != nil {
		e.next.prev = e.prev
	}
	if e == cc.tail {
		cc.tail = e.prev
	}
	// Push front
	cc.pushFront(e)
}

func (cc *CipherCache) removeTail() {
	if cc.tail == nil {
		return
	}
	e := cc.tail
	delete(cc.entries, e.key)
	cc.tail = e.prev
	if cc.tail != nil {
		cc.tail.next = nil
	} else {
		cc.head = nil
	}
}

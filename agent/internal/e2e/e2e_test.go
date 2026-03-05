package e2e

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"testing"
)

func TestCipher_RoundTrip(t *testing.T) {
	// Simulate browser (user) and agent keypairs
	userPriv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	agentPriv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	// Agent creates cipher with its private key + user's public key
	agentCipher, err := NewCipher(agentPriv, userPriv.PublicKey())
	if err != nil {
		t.Fatal(err)
	}

	// User creates cipher with their private key + agent's public key
	userCipher, err := NewCipher(userPriv, agentPriv.PublicKey())
	if err != nil {
		t.Fatal(err)
	}

	// User encrypts, agent decrypts
	plaintext := []byte(`{"method":"GET","path":"/api/storage/my-page/counter"}`)
	ciphertext, err := userCipher.Encrypt(plaintext)
	if err != nil {
		t.Fatal(err)
	}

	if bytes.Equal(plaintext, ciphertext) {
		t.Fatal("ciphertext should differ from plaintext")
	}

	decrypted, err := agentCipher.Decrypt(ciphertext)
	if err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(plaintext, decrypted) {
		t.Fatalf("decrypted != plaintext: got %q, want %q", decrypted, plaintext)
	}

	// Agent encrypts response, user decrypts
	response := []byte(`{"status":200,"body":"{\"value\":\"42\"}"}`)
	encResp, err := agentCipher.Encrypt(response)
	if err != nil {
		t.Fatal(err)
	}

	decResp, err := userCipher.Decrypt(encResp)
	if err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(response, decResp) {
		t.Fatalf("decrypted response != original: got %q, want %q", decResp, response)
	}
}

func TestCipher_DifferentNonces(t *testing.T) {
	userPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)
	agentPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)

	cipher, err := NewCipher(agentPriv, userPriv.PublicKey())
	if err != nil {
		t.Fatal(err)
	}

	plaintext := []byte("same plaintext")
	ct1, _ := cipher.Encrypt(plaintext)
	ct2, _ := cipher.Encrypt(plaintext)

	// Same plaintext should produce different ciphertext (random IV)
	if bytes.Equal(ct1, ct2) {
		t.Fatal("encrypting same plaintext twice should produce different ciphertext (random IV)")
	}
}

func TestCipher_TamperedCiphertext(t *testing.T) {
	userPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)
	agentPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)

	cipher, err := NewCipher(agentPriv, userPriv.PublicKey())
	if err != nil {
		t.Fatal(err)
	}

	ct, _ := cipher.Encrypt([]byte("secret data"))

	// Flip a byte in the ciphertext (after the 12-byte IV)
	ct[15] ^= 0xff

	_, err = cipher.Decrypt(ct)
	if err == nil {
		t.Fatal("decryption should fail on tampered ciphertext")
	}
}

func TestCipher_WrongKey(t *testing.T) {
	userPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)
	agentPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)
	wrongPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)

	correctCipher, _ := NewCipher(agentPriv, userPriv.PublicKey())
	wrongCipher, _ := NewCipher(wrongPriv, userPriv.PublicKey())

	ct, _ := correctCipher.Encrypt([]byte("secret"))

	_, err := wrongCipher.Decrypt(ct)
	if err == nil {
		t.Fatal("decryption with wrong key should fail")
	}
}

func TestCipherCache_ReturnsSameCipher(t *testing.T) {
	agentPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)
	cache := NewCipherCache(agentPriv)

	userPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)

	c1, err := cache.Get(userPriv.PublicKey())
	if err != nil {
		t.Fatal(err)
	}

	c2, err := cache.Get(userPriv.PublicKey())
	if err != nil {
		t.Fatal(err)
	}

	if c1 != c2 {
		t.Fatal("cache should return the same cipher instance")
	}
}

func TestCipherCache_DifferentUsersGetDifferentCiphers(t *testing.T) {
	agentPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)
	cache := NewCipherCache(agentPriv)

	user1, _ := ecdh.X25519().GenerateKey(rand.Reader)
	user2, _ := ecdh.X25519().GenerateKey(rand.Reader)

	c1, _ := cache.Get(user1.PublicKey())
	c2, _ := cache.Get(user2.PublicKey())

	if c1 == c2 {
		t.Fatal("different users should get different cipher instances")
	}
}

package testutil

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mehanig/yourbro/agent/internal/storage"
)

// NewTestDB creates a fresh in-memory SQLite database for one test.
// The database is closed when the test finishes.
func NewTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.NewDB(":memory:")
	if err != nil {
		t.Fatalf("NewDB(:memory:): %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// TestKeypair generates a fresh Ed25519 keypair for tests.
func TestKeypair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

// KeyID returns the base64url-encoded public key (matches the keyid format used in signatures).
func KeyID(pub ed25519.PublicKey) string {
	return base64.RawURLEncoding.EncodeToString(pub)
}

// SignRequest signs an http.Request per RFC 9421 matching the format
// VerifyUserSignature middleware expects. No body/Content-Digest.
func SignRequest(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey) {
	SignRequestFull(r, priv, pub, time.Now(), fmt.Sprintf("nonce-%d", time.Now().UnixNano()), "")
}

// SignRequestWithTime signs with a custom created timestamp.
func SignRequestWithTime(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, created time.Time) {
	SignRequestFull(r, priv, pub, created, fmt.Sprintf("nonce-%d", time.Now().UnixNano()), "")
}

// SignRequestWithNonce signs with a specific nonce value.
func SignRequestWithNonce(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, nonce string) {
	SignRequestFull(r, priv, pub, time.Now(), nonce, "")
}

// SignRequestWithBody signs a request that has a body, including Content-Digest.
func SignRequestWithBody(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, body string) {
	SignRequestFull(r, priv, pub, time.Now(), fmt.Sprintf("nonce-%d", time.Now().UnixNano()), body)
}

// SignRequestFull is the core signing function with all parameters.
func SignRequestFull(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, created time.Time, nonce string, body string) {
	keyID := KeyID(pub)
	createdStr := fmt.Sprintf("%d", created.Unix())

	// Determine scheme
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	targetURI := fmt.Sprintf("%s://%s%s", scheme, r.Host, r.RequestURI)

	// Build Content-Digest if body present
	var contentDigest string
	if body != "" {
		hash := sha256.Sum256([]byte(body))
		contentDigest = fmt.Sprintf("sha-256=:%s:", base64.StdEncoding.EncodeToString(hash[:]))
		r.Header.Set("Content-Digest", contentDigest)
	}

	// Build covered components and signature base
	var covered string
	var lines []string
	if body != "" {
		covered = `("@method" "@target-uri" "content-digest")`
		lines = []string{
			fmt.Sprintf(`"@method": %s`, r.Method),
			fmt.Sprintf(`"@target-uri": %s`, targetURI),
			fmt.Sprintf(`"content-digest": %s`, contentDigest),
		}
	} else {
		covered = `("@method" "@target-uri")`
		lines = []string{
			fmt.Sprintf(`"@method": %s`, r.Method),
			fmt.Sprintf(`"@target-uri": %s`, targetURI),
		}
	}

	sigParams := fmt.Sprintf(`%s;created=%s;nonce="%s";keyid="%s"`, covered, createdStr, nonce, keyID)
	lines = append(lines, fmt.Sprintf(`"@signature-params": %s`, sigParams))
	signatureBase := strings.Join(lines, "\n")

	sig := ed25519.Sign(priv, []byte(signatureBase))
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	r.Header.Set("Signature-Input", "sig1="+sigParams)
	r.Header.Set("Signature", fmt.Sprintf("sig1=:%s:", sigB64))
}

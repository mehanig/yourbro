package middleware

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mehanig/yourbro/agent/internal/storage"
)

type contextKey string

const (
	usernameKey  contextKey = "username"
	publicKeyKey contextKey = "public_key"
)

// GetUsername returns the authenticated username from context.
func GetUsername(r *http.Request) string {
	if v, ok := r.Context().Value(usernameKey).(string); ok {
		return v
	}
	return ""
}

// GetPublicKey returns the authenticated public key (base64url) from context.
func GetPublicKey(r *http.Request) string {
	if v, ok := r.Context().Value(publicKeyKey).(string); ok {
		return v
	}
	return ""
}

// nonceCache tracks seen nonces to prevent replay attacks.
// Uses an LRU-style expiry: nonces older than TTL are pruned.
type nonceCache struct {
	mu      sync.Mutex
	entries map[string]time.Time
	ttl     time.Duration
	maxSize int
}

func newNonceCache(ttl time.Duration) *nonceCache {
	return &nonceCache{
		entries: make(map[string]time.Time),
		ttl:     ttl,
		maxSize: 10000,
	}
}

// seen returns true if the nonce was already seen (replay). Adds it if not.
func (c *nonceCache) seen(nonce string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Prune expired entries if cache is getting large
	if len(c.entries) > c.maxSize/2 {
		now := time.Now()
		for k, v := range c.entries {
			if now.Sub(v) > c.ttl {
				delete(c.entries, k)
			}
		}
	}

	if _, exists := c.entries[nonce]; exists {
		return true
	}
	c.entries[nonce] = time.Now()
	return false
}

// sigInputRegex parses RFC 9421 Signature-Input fields.
var sigInputParam = regexp.MustCompile(`(\w+)=(?:"([^"]*)"|(\d+))`)

// VerifyUserSignature middleware verifies RFC 9421 HTTP Message Signatures
// using Ed25519 keys from the authorized_keys table.
func VerifyUserSignature(store *storage.DB) func(http.Handler) http.Handler {
	nonces := newNonceCache(5 * time.Minute)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sigInput := r.Header.Get("Signature-Input")
			sigHeader := r.Header.Get("Signature")
			if sigInput == "" || sigHeader == "" {
				http.Error(w, `{"error":"missing Signature-Input or Signature header"}`, http.StatusUnauthorized)
				return
			}

			// Parse Signature-Input: sig1=("@method" "@target-uri" ...);created=...;nonce="...";keyid="..."
			// Extract the label (e.g. "sig1") and params
			eqIdx := strings.Index(sigInput, "=")
			if eqIdx < 0 {
				http.Error(w, `{"error":"malformed Signature-Input"}`, http.StatusUnauthorized)
				return
			}
			label := sigInput[:eqIdx]
			rest := sigInput[eqIdx+1:]

			// Extract covered components: everything between ( and )
			openParen := strings.Index(rest, "(")
			closeParen := strings.Index(rest, ")")
			if openParen < 0 || closeParen < 0 || closeParen <= openParen {
				http.Error(w, `{"error":"malformed covered components"}`, http.StatusUnauthorized)
				return
			}
			coveredStr := rest[openParen+1 : closeParen]
			paramsStr := rest[closeParen+1:]

			// Parse covered component names (strip quotes)
			var covered []string
			for _, part := range strings.Fields(coveredStr) {
				name := strings.Trim(part, `"`)
				covered = append(covered, name)
			}

			// Parse params
			params := make(map[string]string)
			for _, match := range sigInputParam.FindAllStringSubmatch(paramsStr, -1) {
				key := match[1]
				val := match[2]
				if val == "" {
					val = match[3]
				}
				params[key] = val
			}

			keyID := params["keyid"]
			createdStr := params["created"]
			nonce := params["nonce"]

			if keyID == "" || createdStr == "" || nonce == "" {
				http.Error(w, `{"error":"missing required signature params (keyid, created, nonce)"}`, http.StatusUnauthorized)
				return
			}

			// Check timestamp freshness (±5 min)
			created, err := strconv.ParseInt(createdStr, 10, 64)
			if err != nil {
				http.Error(w, `{"error":"invalid created timestamp"}`, http.StatusUnauthorized)
				return
			}
			drift := math.Abs(float64(time.Now().Unix() - created))
			if drift > 300 {
				http.Error(w, `{"error":"signature timestamp too old or too new"}`, http.StatusUnauthorized)
				return
			}

			// Check nonce not replayed
			if nonces.seen(nonce) {
				http.Error(w, `{"error":"nonce already used (replay detected)"}`, http.StatusUnauthorized)
				return
			}

			// Verify Content-Digest if it's a covered component
			for _, comp := range covered {
				if comp == "content-digest" {
					digestHeader := r.Header.Get("Content-Digest")
					if digestHeader == "" {
						http.Error(w, `{"error":"content-digest header required but missing"}`, http.StatusBadRequest)
						return
					}
					// Read and buffer body
					bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
					if err != nil {
						http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
						return
					}
					r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

					// Compute expected Content-Digest
					hash := sha256.Sum256(bodyBytes)
					expected := fmt.Sprintf("sha-256=:%s:", base64.StdEncoding.EncodeToString(hash[:]))
					if digestHeader != expected {
						http.Error(w, `{"error":"content-digest mismatch"}`, http.StatusBadRequest)
						return
					}
					break
				}
			}

			// Reconstruct signature base per RFC 9421
			var lines []string
			for _, comp := range covered {
				var val string
				switch comp {
				case "@method":
					val = r.Method
				case "@target-uri":
					scheme := "https"
					if r.TLS == nil {
						scheme = "http"
					}
					val = fmt.Sprintf("%s://%s%s", scheme, r.Host, r.RequestURI)
				case "content-digest":
					val = r.Header.Get("Content-Digest")
				default:
					val = r.Header.Get(comp)
				}
				lines = append(lines, fmt.Sprintf("%q: %s", comp, val))
			}
			sigParams := fmt.Sprintf("%s;created=%s;nonce=%q;keyid=%q",
				rest[:closeParen+1], createdStr, nonce, keyID)
			lines = append(lines, fmt.Sprintf("\"@signature-params\": %s", sigParams))
			signatureBase := strings.Join(lines, "\n")

			// Decode public key from keyid
			pubKeyBytes, err := base64.RawURLEncoding.DecodeString(keyID)
			if err != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
				http.Error(w, `{"error":"invalid keyid (not a valid Ed25519 public key)"}`, http.StatusUnauthorized)
				return
			}

			// Extract signature bytes: sig1=:base64:
			sigPrefix := label + "=:"
			sigSuffix := ":"
			if !strings.HasPrefix(sigHeader, sigPrefix) || !strings.HasSuffix(sigHeader, sigSuffix) {
				http.Error(w, `{"error":"malformed Signature header"}`, http.StatusUnauthorized)
				return
			}
			sigB64 := sigHeader[len(sigPrefix) : len(sigHeader)-1]
			sigBytes, err := base64.StdEncoding.DecodeString(sigB64)
			if err != nil {
				http.Error(w, `{"error":"invalid signature encoding"}`, http.StatusUnauthorized)
				return
			}

			// IMPORTANT: Verify signature BEFORE checking authorization (prevents timing oracle)
			if !ed25519.Verify(ed25519.PublicKey(pubKeyBytes), []byte(signatureBase), sigBytes) {
				http.Error(w, `{"error":"invalid signature"}`, http.StatusUnauthorized)
				return
			}

			// Now check if the key is authorized
			username, authorized := store.IsKeyAuthorized(keyID)
			if !authorized {
				http.Error(w, `{"error":"public key not authorized"}`, http.StatusForbidden)
				return
			}

			// Set username and public key in context
			ctx := context.WithValue(r.Context(), usernameKey, username)
			ctx = context.WithValue(ctx, publicKeyKey, keyID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

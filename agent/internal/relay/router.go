package relay

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"

	"crypto/ecdh"

	"github.com/mehanig/yourbro/agent/internal/e2e"
	"github.com/mehanig/yourbro/agent/internal/storage"
)

// Router adapts relay messages to http.Handler calls.
type Router struct {
	Mux          http.Handler
	AgentPrivKey *ecdh.PrivateKey // nil = E2E disabled
	DB           *storage.DB     // for looking up user X25519 keys
}

// HandleRequest converts a relay Request into an http.Request, routes it
// through the chi router, and returns the Response.
func (r *Router) HandleRequest(ctx context.Context, req Request) Response {
	// Handle E2E encrypted requests
	if req.Encrypted && r.AgentPrivKey != nil {
		return r.handleEncryptedRequest(ctx, req)
	}

	return r.handleCleartextRequest(ctx, req)
}

func (r *Router) handleEncryptedRequest(ctx context.Context, req Request) Response {
	// Decode the encrypted payload
	ciphertext, err := base64.StdEncoding.DecodeString(req.Payload)
	if err != nil {
		log.Printf("E2E: failed to decode payload: %v", err)
		body := `{"error":"invalid encrypted payload"}`
		return Response{ID: req.ID, Status: 400, Body: &body}
	}

	// Find the cipher by key_id (X25519 public key of sender)
	cipher, err := r.getUserCipher(req.KeyID)
	if err != nil {
		log.Printf("E2E: no cipher available: %v", err)
		body := `{"error":"e2e decryption not available"}`
		return Response{ID: req.ID, Status: 500, Body: &body}
	}

	// Decrypt
	plaintext, err := cipher.Decrypt(ciphertext)
	if err != nil {
		log.Printf("E2E: decryption failed: %v", err)
		body := `{"error":"decryption failed"}`
		return Response{ID: req.ID, Status: 400, Body: &body}
	}

	// Parse the decrypted relay request
	var innerReq Request
	if err := json.Unmarshal(plaintext, &innerReq); err != nil {
		log.Printf("E2E: invalid decrypted payload: %v", err)
		body := `{"error":"invalid decrypted payload"}`
		return Response{ID: req.ID, Status: 400, Body: &body}
	}
	innerReq.ID = req.ID

	// Inject key_id so inner handlers know which user made the request
	if req.KeyID != "" {
		if innerReq.Headers == nil {
			innerReq.Headers = make(map[string]string)
		}
		innerReq.Headers["X-Yourbro-Key-ID"] = req.KeyID
	}

	// Process the cleartext request
	resp := r.handleCleartextRequest(ctx, innerReq)

	// Encrypt the response
	respJSON, err := json.Marshal(resp)
	if err != nil {
		body := `{"error":"failed to marshal response"}`
		return Response{ID: req.ID, Status: 500, Body: &body}
	}

	encResp, err := cipher.Encrypt(respJSON)
	if err != nil {
		body := `{"error":"encryption failed"}`
		return Response{ID: req.ID, Status: 500, Body: &body}
	}

	return Response{
		ID:        req.ID,
		Encrypted: true,
		Payload:   base64.StdEncoding.EncodeToString(encResp),
	}
}

func (r *Router) getUserCipher(keyID string) (*e2e.Cipher, error) {
	if r.DB == nil {
		return nil, fmt.Errorf("no database")
	}

	// Look up by key_id if provided (base64url-encoded X25519 public key)
	if keyID != "" {
		keyBytes, err := base64.RawURLEncoding.DecodeString(keyID)
		if err == nil && len(keyBytes) == 32 {
			// 1. Try paired user lookup (authorized_keys)
			pub, err := r.DB.GetX25519KeyByPublicBytes(keyBytes)
			if err == nil {
				return e2e.NewCipher(r.AgentPrivKey, pub)
			}

			// 2. Accept anonymous key directly (for public page viewers)
			curve := ecdh.X25519()
			anonPub, err := curve.NewPublicKey(keyBytes)
			if err != nil {
				return nil, fmt.Errorf("invalid X25519 public key")
			}
			return e2e.NewCipher(r.AgentPrivKey, anonPub)
		}
		return nil, fmt.Errorf("invalid key_id encoding")
	}

	// Fallback: single-user mode (no key_id provided)
	keys := r.DB.ListAuthorizedKeys()
	if len(keys) == 0 {
		return nil, fmt.Errorf("no paired users with X25519 keys")
	}
	if len(keys) > 1 {
		log.Printf("E2E: WARNING — multiple paired users but no key_id in request, using first key")
	}
	return e2e.NewCipher(r.AgentPrivKey, keys[0])
}

// allowedRelayPrefixes defines which paths the relay is allowed to forward.
// Everything else is rejected — internal/admin routes must not be reachable via relay.
var allowedRelayPrefixes = []string{"/api/", "/health"}

func isRelayPathAllowed(path string) bool {
	for _, prefix := range allowedRelayPrefixes {
		if strings.HasPrefix(path, prefix) || path == prefix {
			return true
		}
	}
	return false
}

func (r *Router) handleCleartextRequest(ctx context.Context, req Request) Response {
	// Reject paths that shouldn't be reachable via relay
	if !isRelayPathAllowed(req.Path) {
		body := `{"error":"forbidden"}`
		return Response{ID: req.ID, Status: 403, Body: &body}
	}

	// Build HTTP request body
	var bodyReader *bytes.Reader
	if req.Body != nil {
		// Body is base64 encoded in the relay message
		decoded, err := base64.StdEncoding.DecodeString(*req.Body)
		if err != nil {
			// Try raw string if not base64
			bodyReader = bytes.NewReader([]byte(*req.Body))
		} else {
			bodyReader = bytes.NewReader(decoded)
		}
	} else {
		bodyReader = bytes.NewReader(nil)
	}

	targetURL := "https://relay.internal" + req.Path
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL, bodyReader)
	if err != nil {
		body := `{"error":"failed to build request"}`
		return Response{ID: req.ID, Status: 500, Body: &body}
	}

	// Copy headers from relay message
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}
	if httpReq.Header.Get("Content-Type") == "" {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	// Route through chi router
	rec := httptest.NewRecorder()
	r.Mux.ServeHTTP(rec, httpReq)

	// Build response
	respHeaders := make(map[string]string)
	for k := range rec.Header() {
		respHeaders[k] = rec.Header().Get(k)
	}

	respBody := rec.Body.String()
	return Response{
		ID:      req.ID,
		Status:  rec.Code,
		Headers: respHeaders,
		Body:    &respBody,
	}
}

package relay

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"

	"github.com/mehanig/yourbro/agent/internal/e2e"
	"github.com/mehanig/yourbro/agent/internal/storage"
)

// Router adapts relay messages to http.Handler calls.
type Router struct {
	Mux         http.Handler
	CipherCache *e2e.CipherCache // nil = E2E disabled
	DB          *storage.DB      // for looking up user X25519 keys
}

// HandleRequest converts a relay Request into an http.Request, routes it
// through the chi router, and returns the Response.
func (r *Router) HandleRequest(ctx context.Context, req Request) Response {
	// Handle E2E encrypted requests
	if req.Encrypted && r.CipherCache != nil {
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

	// Find the cipher — use first authorized user's X25519 key
	// (single-user agent for now)
	cipher, err := r.getUserCipher()
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

func (r *Router) getUserCipher() (*e2e.Cipher, error) {
	if r.DB == nil {
		return nil, fmt.Errorf("no database")
	}

	// Get first authorized user's X25519 key
	keys := r.DB.ListAuthorizedKeysWithX25519()
	if len(keys) == 0 {
		return nil, fmt.Errorf("no paired users with X25519 keys")
	}

	return r.CipherCache.Get(keys[0])
}

func (r *Router) handleCleartextRequest(ctx context.Context, req Request) Response {
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

	// Use canonical host for relay-mode RFC 9421 signatures
	targetURL := "https://relay.internal" + req.Path
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL, bodyReader)
	if err != nil {
		body := `{"error":"failed to build request"}`
		return Response{ID: req.ID, Status: 500, Body: &body}
	}

	// Mark as TLS so the auth middleware reconstructs @target-uri with https://
	// (matching what the SDK signed against)
	httpReq.TLS = &tls.ConnectionState{}

	// NewRequestWithContext leaves RequestURI empty; the auth middleware uses it
	// to reconstruct @target-uri for RFC 9421 signature verification.
	httpReq.RequestURI = req.Path

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

package relay

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
)

// Router adapts relay messages to http.Handler calls.
type Router struct {
	Mux http.Handler
}

// HandleRequest converts a relay Request into an http.Request, routes it
// through the chi router, and returns the Response.
func (r *Router) HandleRequest(ctx context.Context, req Request) Response {
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

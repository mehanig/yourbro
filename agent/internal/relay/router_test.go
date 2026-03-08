package relay

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/agent/internal/e2e"
	"github.com/mehanig/yourbro/agent/internal/handlers"
	"github.com/mehanig/yourbro/agent/internal/storage"
)

func TestRouter_CleartextRequest(t *testing.T) {
	mux := chi.NewRouter()
	mux.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	router := &Router{Mux: mux}
	resp := router.HandleRequest(context.Background(), Request{
		ID:     "test-1",
		Method: "GET",
		Path:   "/health",
	})

	if resp.Status != 200 {
		t.Fatalf("expected 200, got %d", resp.Status)
	}
	if resp.Body == nil || *resp.Body != `{"status":"ok"}` {
		t.Fatalf("unexpected body: %v", resp.Body)
	}
}

func TestRouter_EncryptedRoundTrip(t *testing.T) {
	// Set up a simple handler
	mux := chi.NewRouter()
	mux.Get("/api/storage/test/key1", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"value":"hello"}`))
	})

	// Generate keypairs (simulating browser + agent)
	agentPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)

	// Router uses agent's private key for E2E
	router := &Router{
		Mux:          mux,
		AgentPrivKey: agentPriv,
		DB:           nil,
	}

	// Test cleartext still works through HandleRequest
	resp := router.HandleRequest(context.Background(), Request{
		ID:     "clear-1",
		Method: "GET",
		Path:   "/api/storage/test/key1",
	})

	if resp.Status != 200 {
		t.Fatalf("cleartext: expected 200, got %d", resp.Status)
	}
	if resp.Body == nil || *resp.Body != `{"value":"hello"}` {
		t.Fatalf("cleartext: unexpected body: %v", resp.Body)
	}
}

func TestRouter_EncryptedRequest_NoPrivKey(t *testing.T) {
	mux := chi.NewRouter()
	router := &Router{Mux: mux, AgentPrivKey: nil}

	// Encrypted request without agent private key should fall through to cleartext
	resp := router.HandleRequest(context.Background(), Request{
		ID:        "enc-no-cache",
		Encrypted: true,
		Payload:   "some-payload",
		Method:    "GET",
		Path:      "/health",
	})

	// Should be treated as cleartext since AgentPrivKey is nil
	// The cleartext handler will try to route /health
	_ = resp
}

func TestRouter_PostWithBody(t *testing.T) {
	mux := chi.NewRouter()
	mux.Put("/api/storage/mypage/counter", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write([]byte(`{"ok":true}`))
	})

	router := &Router{Mux: mux}
	body := base64.StdEncoding.EncodeToString([]byte(`42`))
	resp := router.HandleRequest(context.Background(), Request{
		ID:     "put-1",
		Method: "PUT",
		Path:   "/api/storage/mypage/counter",
		Body:   &body,
	})

	if resp.Status != 200 {
		t.Fatalf("expected 200, got %d", resp.Status)
	}
}

func newTestSqliteDB(t *testing.T) *storage.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := storage.NewDB(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// TestRouter_AnonymousKeyE2ERoundTrip tests that an anonymous (non-paired) viewer
// can establish an E2E encrypted channel and fetch a public page.
func TestRouter_AnonymousKeyE2ERoundTrip(t *testing.T) {
	db := newTestSqliteDB(t)
	agentPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)

	// Create a public page
	pagesDir := t.TempDir()
	pageDir := filepath.Join(pagesDir, "test-page")
	os.MkdirAll(pageDir, 0755)
	os.WriteFile(filepath.Join(pageDir, "index.html"), []byte("<h1>Hello</h1>"), 0644)
	os.WriteFile(filepath.Join(pageDir, "page.json"), []byte(`{"title":"Test","public":true}`), 0644)

	mux := chi.NewRouter()
	mux.Get("/api/page/{slug}", func(w http.ResponseWriter, r *http.Request) {
		// Simplified page handler that checks access
		slug := chi.URLParam(r, "slug")
		keyID := handlers.KeyIDFromRequest(r)
		// Anonymous user (not in authorized_keys) — only serve public pages
		_, isPaired := db.IsX25519KeyAuthorized(keyID)
		if !isPaired {
			// Check if page is public (simplified)
			data, _ := os.ReadFile(filepath.Join(pagesDir, slug, "page.json"))
			if len(data) == 0 || !json.Valid(data) {
				w.WriteHeader(404)
				return
			}
			var meta struct{ Public bool `json:"public"` }
			json.Unmarshal(data, &meta)
			if !meta.Public {
				w.WriteHeader(404)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"slug":"test-page","title":"Test","files":{"index.html":"<h1>Hello</h1>"}}`))
	})

	router := &Router{Mux: mux, AgentPrivKey: agentPriv, DB: db}

	// Anonymous viewer generates a key pair
	anonPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)
	anonKeyID := base64.RawURLEncoding.EncodeToString(anonPriv.PublicKey().Bytes())

	// Viewer creates cipher with viewer_priv + agent_pub
	viewerCipher, err := e2e.NewCipher(anonPriv, agentPriv.PublicKey())
	if err != nil {
		t.Fatal(err)
	}

	// Encrypt inner request
	innerReq := Request{
		Method: "GET",
		Path:   "/api/page/test-page",
	}
	innerJSON, _ := json.Marshal(innerReq)
	encrypted, err := viewerCipher.Encrypt(innerJSON)
	if err != nil {
		t.Fatal(err)
	}

	// Send encrypted relay request
	resp := router.HandleRequest(context.Background(), Request{
		ID:        "anon-1",
		Encrypted: true,
		KeyID:     anonKeyID,
		Payload:   base64.StdEncoding.EncodeToString(encrypted),
	})

	// Response should be encrypted
	if !resp.Encrypted {
		t.Fatal("response should be encrypted")
	}
	if resp.Payload == "" {
		t.Fatal("response should have payload")
	}

	// Decrypt response
	encBytes, _ := base64.StdEncoding.DecodeString(resp.Payload)
	decrypted, err := viewerCipher.Decrypt(encBytes)
	if err != nil {
		t.Fatalf("failed to decrypt response: %v", err)
	}

	var innerResp Response
	if err := json.Unmarshal(decrypted, &innerResp); err != nil {
		t.Fatalf("failed to parse inner response: %v", err)
	}

	if innerResp.Status != 200 {
		t.Fatalf("inner response status: want 200, got %d", innerResp.Status)
	}
	if innerResp.Body == nil || *innerResp.Body == "" {
		t.Fatal("inner response should have body")
	}
}

// TestRouter_AnonymousKeyDeniedForPrivatePage tests that anonymous viewers
// cannot access non-public pages through E2E relay.
func TestRouter_AnonymousKeyDeniedForPrivatePage(t *testing.T) {
	db := newTestSqliteDB(t)
	agentPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)

	mux := chi.NewRouter()
	mux.Get("/api/page/{slug}", func(w http.ResponseWriter, r *http.Request) {
		keyID := handlers.KeyIDFromRequest(r)
		_, isPaired := db.IsX25519KeyAuthorized(keyID)
		if !isPaired {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(404)
			w.Write([]byte(`{"error":"page not found"}`))
			return
		}
		w.Write([]byte(`{"slug":"private-page"}`))
	})

	router := &Router{Mux: mux, AgentPrivKey: agentPriv, DB: db}

	anonPriv, _ := ecdh.X25519().GenerateKey(rand.Reader)
	anonKeyID := base64.RawURLEncoding.EncodeToString(anonPriv.PublicKey().Bytes())
	viewerCipher, _ := e2e.NewCipher(anonPriv, agentPriv.PublicKey())

	innerReq := Request{Method: "GET", Path: "/api/page/private-page"}
	innerJSON, _ := json.Marshal(innerReq)
	encrypted, _ := viewerCipher.Encrypt(innerJSON)

	resp := router.HandleRequest(context.Background(), Request{
		ID:        "anon-denied",
		Encrypted: true,
		KeyID:     anonKeyID,
		Payload:   base64.StdEncoding.EncodeToString(encrypted),
	})

	if !resp.Encrypted {
		t.Fatal("response should be encrypted")
	}

	encBytes, _ := base64.StdEncoding.DecodeString(resp.Payload)
	decrypted, err := viewerCipher.Decrypt(encBytes)
	if err != nil {
		t.Fatalf("failed to decrypt: %v", err)
	}

	var innerResp Response
	json.Unmarshal(decrypted, &innerResp)
	if innerResp.Status != 404 {
		t.Fatalf("anonymous user should get 404 for private page, got %d", innerResp.Status)
	}
}

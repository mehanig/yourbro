package handlers

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// newIntegrationRouter builds a full agent router matching the new architecture:
// - Pairing via POST /api/pair
// - Auth check via POST /api/auth-check (no middleware — E2E relay is auth)
// - Key revocation via POST /api/revoke-key (X-Yourbro-Key-ID header)
// - Storage routes (no middleware — reached via E2E encrypted relay)
func newIntegrationRouter(t *testing.T) (*PairHandler, *chi.Mux) {
	t.Helper()
	db := newTestDB(t)

	storageHandler := &StorageHandler{DB: db}
	pairHandler := &PairHandler{
		DB:            db,
		PairingCode:   "INTGCODE",
		PairingExpiry: time.Now().Add(5 * time.Minute),
	}

	r := chi.NewRouter()
	r.Post("/api/pair", pairHandler.Pair)
	r.Post("/api/auth-check", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"paired"}`))
	})
	r.Post("/api/revoke-key", pairHandler.RevokeKey)
	r.Route("/api/storage/{slug}", func(r chi.Router) {
		r.Get("/", storageHandler.List)
		r.Get("/{key}", storageHandler.Get)
		r.Put("/{key}", storageHandler.Set)
		r.Delete("/{key}", storageHandler.Delete)
	})
	return pairHandler, r
}

func TestIntegration_FullLifecycle(t *testing.T) {
	_, router := newIntegrationRouter(t)
	key := make([]byte, 32)
	key[0] = 42
	keyID := base64.RawURLEncoding.EncodeToString(key)

	// Step 1: Pair
	pairBody := `{"pairing_code":"INTGCODE","user_x25519_public_key":"` + keyID + `","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(pairBody))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("pair: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// Step 2: Set a value (in real flow this reaches the agent via E2E relay)
	setBody := `{"count":42}`
	req = httptest.NewRequest("PUT", "/api/storage/mypage/counter", strings.NewReader(setBody))
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("set: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// Step 3: Get the value
	req = httptest.NewRequest("GET", "/api/storage/mypage/counter", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"value":"{\"count\":42}"`) {
		t.Errorf("get body: %s", w.Body.String())
	}

	// Step 4: List
	req = httptest.NewRequest("GET", "/api/storage/mypage/", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d", w.Code)
	}

	// Step 5: Delete entry
	req = httptest.NewRequest("DELETE", "/api/storage/mypage/counter", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("delete entry: want 200, got %d", w.Code)
	}

	// Step 6: Verify entry is gone
	req = httptest.NewRequest("GET", "/api/storage/mypage/counter", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("after delete: want 404, got %d", w.Code)
	}
}

func TestIntegration_PairRevokeKey(t *testing.T) {
	h, router := newIntegrationRouter(t)
	key := make([]byte, 32)
	key[0] = 99
	keyID := base64.RawURLEncoding.EncodeToString(key)

	// Pair
	pairBody := `{"pairing_code":"INTGCODE","user_x25519_public_key":"` + keyID + `","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(pairBody))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("pair: want 200, got %d", w.Code)
	}

	// Verify paired
	if _, ok := h.DB.IsX25519KeyAuthorized(keyID); !ok {
		t.Fatal("should be authorized after pairing")
	}

	// Revoke key via X-Yourbro-Key-ID header
	req = httptest.NewRequest("POST", "/api/revoke-key", nil)
	req.Header.Set("X-Yourbro-Key-ID", keyID)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("revoke: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// Key should be gone
	if _, ok := h.DB.IsX25519KeyAuthorized(keyID); ok {
		t.Fatal("key should be removed after revocation")
	}
}

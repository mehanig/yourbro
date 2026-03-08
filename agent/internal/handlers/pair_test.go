package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/agent/internal/storage"
)

func newTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.NewDB(":memory:")
	if err != nil {
		t.Fatalf("NewDB(:memory:): %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func newPairHandler(t *testing.T) (*PairHandler, *chi.Mux) {
	t.Helper()
	db := newTestDB(t)
	h := &PairHandler{
		DB:            db,
		PairingCode:   "TESTCODE",
		PairingExpiry: time.Now().Add(5 * time.Minute),
	}
	r := chi.NewRouter()
	r.Post("/api/pair", h.Pair)
	r.Post("/api/revoke-key", h.RevokeKey)
	return h, r
}

func testX25519Key(t *testing.T) ([]byte, string) {
	t.Helper()
	key := make([]byte, 32)
	key[0] = byte(t.Name()[0]) // vary per test
	keyID := base64.RawURLEncoding.EncodeToString(key)
	return key, keyID
}

func validPairBody(x25519PubB64 string) string {
	return `{"pairing_code":"TESTCODE","user_x25519_public_key":"` + x25519PubB64 + `","username":"alice"}`
}

// --- Pairing Tests ---

func TestPair_Success(t *testing.T) {
	h, router := newPairHandler(t)
	_, keyID := testX25519Key(t)

	body := validPairBody(keyID)
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["status"] != "paired" {
		t.Fatalf("want status=paired, got %v", resp)
	}

	// Key should be stored
	username, ok := h.DB.IsX25519KeyAuthorized(keyID)
	if !ok {
		t.Fatal("key should be authorized after pairing")
	}
	if username != "alice" {
		t.Fatalf("want username alice, got %s", username)
	}
}

func TestPair_WrongCode(t *testing.T) {
	_, router := newPairHandler(t)
	_, keyID := testX25519Key(t)

	body := `{"pairing_code":"WRONGCODE","user_x25519_public_key":"` + keyID + `","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPair_AlreadyUsed(t *testing.T) {
	_, router := newPairHandler(t)
	_, keyID := testX25519Key(t)
	body := validPairBody(keyID)

	// First pairing succeeds
	req1 := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w1 := httptest.NewRecorder()
	router.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("first pair: want 200, got %d", w1.Code)
	}

	// Second pairing fails (code already used)
	req2 := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusGone {
		t.Fatalf("second pair: want 410, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestPair_Expired(t *testing.T) {
	db := newTestDB(t)
	h := &PairHandler{
		DB:            db,
		PairingCode:   "TESTCODE",
		PairingExpiry: time.Now().Add(-1 * time.Second), // already expired
	}
	r := chi.NewRouter()
	r.Post("/api/pair", h.Pair)

	_, keyID := testX25519Key(t)
	body := validPairBody(keyID)
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGone {
		t.Fatalf("want 410, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPair_RateLimit(t *testing.T) {
	_, router := newPairHandler(t)
	_, keyID := testX25519Key(t)

	wrongBody := `{"pairing_code":"WRONG","user_x25519_public_key":"` + keyID + `","username":"alice"}`

	// Send 5 wrong attempts
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(wrongBody))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: want 401, got %d", i+1, w.Code)
		}
	}

	// 6th attempt (even with correct code) should be rate limited
	correctBody := validPairBody(keyID)
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(correctBody))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("6th attempt: want 429, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPair_InvalidJSON(t *testing.T) {
	_, router := newPairHandler(t)
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestPair_InvalidPublicKey_BadBase64(t *testing.T) {
	_, router := newPairHandler(t)
	body := `{"pairing_code":"TESTCODE","user_x25519_public_key":"not-valid!!!","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPair_InvalidPublicKey_WrongLength(t *testing.T) {
	_, router := newPairHandler(t)
	shortKey := base64.RawURLEncoding.EncodeToString(make([]byte, 16))
	body := `{"pairing_code":"TESTCODE","user_x25519_public_key":"` + shortKey + `","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPair_EmptyUsername(t *testing.T) {
	_, router := newPairHandler(t)
	_, keyID := testX25519Key(t)
	body := `{"pairing_code":"TESTCODE","user_x25519_public_key":"` + keyID + `","username":""}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
	}
}

// --- Key Revocation Tests ---

func TestRevokeKey_Success(t *testing.T) {
	h, router := newPairHandler(t)
	_, keyID := testX25519Key(t)

	// First pair
	body := validPairBody(keyID)
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("pair: want 200, got %d", w.Code)
	}

	// Now revoke via POST with key_id in context (set by relay router after E2E decryption)
	delReq := httptest.NewRequest("POST", "/api/revoke-key", nil)
	delReq = delReq.WithContext(WithKeyID(delReq.Context(), keyID))
	delW := httptest.NewRecorder()
	router.ServeHTTP(delW, delReq)
	if delW.Code != http.StatusOK {
		t.Fatalf("revoke: want 200, got %d: %s", delW.Code, delW.Body.String())
	}

	// Key should be gone
	if _, ok := h.DB.IsX25519KeyAuthorized(keyID); ok {
		t.Fatal("key should be removed after revocation")
	}
}

func TestRevokeKey_MissingKeyID(t *testing.T) {
	_, router := newPairHandler(t)

	req := httptest.NewRequest("POST", "/api/revoke-key", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
	}
}

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
	mw "github.com/mehanig/yourbro/agent/internal/middleware"
	"github.com/mehanig/yourbro/agent/internal/testutil"
)

func newPairHandler(t *testing.T) (*PairHandler, *chi.Mux) {
	t.Helper()
	db := testutil.NewTestDB(t)
	h := &PairHandler{
		DB:            db,
		PairingCode:   "TESTCODE",
		PairingExpiry: time.Now().Add(5 * time.Minute),
	}
	r := chi.NewRouter()
	r.Post("/api/pair", h.Pair)
	// Key revocation route (protected by signature verification)
	r.Route("/api/keys", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Delete("/", h.RevokeKey)
	})
	return h, r
}

func validPairBody(pubKey string) string {
	return `{"pairing_code":"TESTCODE","user_public_key":"` + pubKey + `","username":"alice"}`
}

// --- Pairing Tests ---

func TestPair_Success(t *testing.T) {
	h, router := newPairHandler(t)
	pub, _ := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)

	body := validPairBody(pubB64)
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
	username, ok := h.DB.IsKeyAuthorized(pubB64)
	if !ok {
		t.Fatal("key should be authorized after pairing")
	}
	if username != "alice" {
		t.Fatalf("want username alice, got %s", username)
	}
}

func TestPair_WrongCode(t *testing.T) {
	_, router := newPairHandler(t)
	pub, _ := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)

	body := `{"pairing_code":"WRONGCODE","user_public_key":"` + pubB64 + `","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPair_AlreadyUsed(t *testing.T) {
	_, router := newPairHandler(t)
	pub, _ := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)
	body := validPairBody(pubB64)

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
	db := testutil.NewTestDB(t)
	h := &PairHandler{
		DB:            db,
		PairingCode:   "TESTCODE",
		PairingExpiry: time.Now().Add(-1 * time.Second), // already expired
	}
	r := chi.NewRouter()
	r.Post("/api/pair", h.Pair)

	pub, _ := testutil.TestKeypair(t)
	body := validPairBody(testutil.KeyID(pub))
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGone {
		t.Fatalf("want 410, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPair_RateLimit(t *testing.T) {
	_, router := newPairHandler(t)
	pub, _ := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)

	wrongBody := `{"pairing_code":"WRONG","user_public_key":"` + pubB64 + `","username":"alice"}`

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
	correctBody := validPairBody(pubB64)
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
	body := `{"pairing_code":"TESTCODE","user_public_key":"not-valid!!!","username":"alice"}`
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
	body := `{"pairing_code":"TESTCODE","user_public_key":"` + shortKey + `","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPair_EmptyUsername(t *testing.T) {
	_, router := newPairHandler(t)
	pub, _ := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)
	body := `{"pairing_code":"TESTCODE","user_public_key":"` + pubB64 + `","username":""}`
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
	pub, priv := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)

	// First pair
	body := validPairBody(pubB64)
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("pair: want 200, got %d", w.Code)
	}

	// Now revoke via signed DELETE
	delReq := httptest.NewRequest("DELETE", "http://localhost/api/keys", nil)
	testutil.SignRequest(delReq, priv, pub)
	delW := httptest.NewRecorder()
	router.ServeHTTP(delW, delReq)
	if delW.Code != http.StatusOK {
		t.Fatalf("revoke: want 200, got %d: %s", delW.Code, delW.Body.String())
	}

	// Key should be gone
	if _, ok := h.DB.IsKeyAuthorized(pubB64); ok {
		t.Fatal("key should be removed after revocation")
	}
}

func TestRevokeKey_SubsequentAccessDenied(t *testing.T) {
	_, router := newPairHandler(t)
	pub, priv := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)

	// Pair
	body := validPairBody(pubB64)
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("pair: want 200, got %d", w.Code)
	}

	// Revoke
	delReq := httptest.NewRequest("DELETE", "http://localhost/api/keys", nil)
	testutil.SignRequest(delReq, priv, pub)
	delW := httptest.NewRecorder()
	router.ServeHTTP(delW, delReq)
	if delW.Code != http.StatusOK {
		t.Fatalf("revoke: want 200, got %d", delW.Code)
	}

	// Attempt another signed request — should be rejected (403)
	req2 := httptest.NewRequest("DELETE", "http://localhost/api/keys", nil)
	testutil.SignRequest(req2, priv, pub)
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusForbidden {
		t.Fatalf("after revoke: want 403, got %d: %s", w2.Code, w2.Body.String())
	}
}

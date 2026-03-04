package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	mw "github.com/mehanig/yourbro/agent/internal/middleware"
	"github.com/mehanig/yourbro/agent/internal/testutil"
)

// newIntegrationRouter builds a full agent router with auth middleware on storage and key routes.
func newIntegrationRouter(t *testing.T) (*PairHandler, *chi.Mux) {
	t.Helper()
	db := testutil.NewTestDB(t)

	storageHandler := &StorageHandler{DB: db}
	pairHandler := &PairHandler{
		DB:            db,
		PairingCode:   "INTGCODE",
		PairingExpiry: time.Now().Add(5 * time.Minute),
	}

	r := chi.NewRouter()
	r.Post("/api/pair", pairHandler.Pair)
	r.Route("/api/keys", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Delete("/", pairHandler.RevokeKey)
	})
	r.Route("/api/storage/{slug}", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Get("/", storageHandler.List)
		r.Get("/{key}", storageHandler.Get)
		r.Put("/{key}", storageHandler.Set)
		r.Delete("/{key}", storageHandler.Delete)
	})
	return pairHandler, r
}

func TestIntegration_FullLifecycle(t *testing.T) {
	_, router := newIntegrationRouter(t)
	pub, priv := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)

	// Step 1: Pair
	pairBody := `{"pairing_code":"INTGCODE","user_public_key":"` + pubB64 + `","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(pairBody))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("pair: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// Step 2: Set a value (signed)
	setBody := `{"count":42}`
	req = httptest.NewRequest("PUT", "http://localhost/api/storage/mypage/counter", strings.NewReader(setBody))
	testutil.SignRequestWithBody(req, priv, pub, setBody)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("set: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// Step 3: Get the value (signed)
	req = httptest.NewRequest("GET", "http://localhost/api/storage/mypage/counter", nil)
	testutil.SignRequest(req, priv, pub)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"value":"{\"count\":42}"`) {
		t.Errorf("get body: %s", w.Body.String())
	}

	// Step 4: List (signed)
	req = httptest.NewRequest("GET", "http://localhost/api/storage/mypage/", nil)
	testutil.SignRequest(req, priv, pub)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d", w.Code)
	}

	// Step 5: Delete entry (signed)
	req = httptest.NewRequest("DELETE", "http://localhost/api/storage/mypage/counter", nil)
	testutil.SignRequest(req, priv, pub)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("delete entry: want 200, got %d", w.Code)
	}

	// Step 6: Verify entry is gone
	req = httptest.NewRequest("GET", "http://localhost/api/storage/mypage/counter", nil)
	testutil.SignRequest(req, priv, pub)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("after delete: want 404, got %d", w.Code)
	}
}

func TestIntegration_PairRevokeAccessDenied(t *testing.T) {
	_, router := newIntegrationRouter(t)
	pub, priv := testutil.TestKeypair(t)
	pubB64 := testutil.KeyID(pub)

	// Pair
	pairBody := `{"pairing_code":"INTGCODE","user_public_key":"` + pubB64 + `","username":"alice"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(pairBody))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("pair: want 200, got %d", w.Code)
	}

	// Set works
	setBody := `"hello"`
	req = httptest.NewRequest("PUT", "http://localhost/api/storage/test/key", strings.NewReader(setBody))
	testutil.SignRequestWithBody(req, priv, pub, setBody)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("set before revoke: want 200, got %d", w.Code)
	}

	// Revoke key
	req = httptest.NewRequest("DELETE", "http://localhost/api/keys", nil)
	testutil.SignRequest(req, priv, pub)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("revoke: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// Storage access now denied (403)
	req = httptest.NewRequest("GET", "http://localhost/api/storage/test/key", nil)
	testutil.SignRequest(req, priv, pub)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("after revoke: want 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestIntegration_MultipleUsersIsolated(t *testing.T) {
	db := testutil.NewTestDB(t)
	storageHandler := &StorageHandler{DB: db}

	pubA, privA := testutil.TestKeypair(t)
	pubB, privB := testutil.TestKeypair(t)
	kidA := testutil.KeyID(pubA)
	kidB := testutil.KeyID(pubB)

	// Add both keys
	db.AddAuthorizedKey(kidA, "alice")
	db.AddAuthorizedKey(kidB, "bob")

	r := chi.NewRouter()
	r.Route("/api/storage/{slug}", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Put("/{key}", storageHandler.Set)
		r.Get("/{key}", storageHandler.Get)
	})

	// Alice writes
	setBody := `"alice-data"`
	req := httptest.NewRequest("PUT", "http://localhost/api/storage/page/data", strings.NewReader(setBody))
	testutil.SignRequestWithBody(req, privA, pubA, setBody)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("alice set: want 200, got %d", w.Code)
	}

	// Bob can also read (storage is per-slug, not per-user)
	req = httptest.NewRequest("GET", "http://localhost/api/storage/page/data", nil)
	testutil.SignRequest(req, privB, pubB)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("bob get: want 200, got %d", w.Code)
	}

	// Unsigned request is rejected
	req = httptest.NewRequest("GET", "http://localhost/api/storage/page/data", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned: want 401, got %d", w.Code)
	}
}

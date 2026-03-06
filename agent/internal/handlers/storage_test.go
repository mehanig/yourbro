package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func newStorageRouter(t *testing.T) *chi.Mux {
	t.Helper()
	db := newTestDB(t)
	h := &StorageHandler{DB: db}
	r := chi.NewRouter()
	r.Route("/api/storage/{slug}", func(r chi.Router) {
		r.Get("/", h.List)
		r.Get("/{key}", h.Get)
		r.Put("/{key}", h.Set)
		r.Delete("/{key}", h.Delete)
	})
	return r
}

func TestStorageHandler_SetAndGet(t *testing.T) {
	router := newStorageRouter(t)

	// PUT
	body := `{"count":42}`
	req := httptest.NewRequest("PUT", "/api/storage/mypage/counter", strings.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// GET
	req = httptest.NewRequest("GET", "/api/storage/mypage/counter", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET: want 200, got %d", w.Code)
	}
	// Response is a storage.Entry with value_json inside a "value" field
	if !strings.Contains(w.Body.String(), `"value":"{\"count\":42}"`) {
		t.Errorf("unexpected body: %s", w.Body.String())
	}
}

func TestStorageHandler_GetNotFound(t *testing.T) {
	router := newStorageRouter(t)
	req := httptest.NewRequest("GET", "/api/storage/slug/missing", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

func TestStorageHandler_SetInvalidJSON(t *testing.T) {
	router := newStorageRouter(t)
	req := httptest.NewRequest("PUT", "/api/storage/slug/key", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestStorageHandler_Delete(t *testing.T) {
	router := newStorageRouter(t)

	// Set then delete
	req := httptest.NewRequest("PUT", "/api/storage/slug/key", strings.NewReader(`"v"`))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	req = httptest.NewRequest("DELETE", "/api/storage/slug/key", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE: want 200, got %d", w.Code)
	}

	// GET should now 404
	req = httptest.NewRequest("GET", "/api/storage/slug/key", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("after DELETE: want 404, got %d", w.Code)
	}
}

func TestStorageHandler_DeleteNonexistent(t *testing.T) {
	router := newStorageRouter(t)
	req := httptest.NewRequest("DELETE", "/api/storage/slug/missing", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("idempotent DELETE: want 200, got %d", w.Code)
	}
}

func TestStorageHandler_List(t *testing.T) {
	router := newStorageRouter(t)

	// Set multiple entries
	for _, key := range []string{"a", "b", "c"} {
		req := httptest.NewRequest("PUT", "/api/storage/slug/"+key, strings.NewReader(`"`+key+`"`))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
	}

	// List all
	req := httptest.NewRequest("GET", "/api/storage/slug/", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("LIST: want 200, got %d", w.Code)
	}
	// Should contain all three
	body := w.Body.String()
	for _, key := range []string{`"a"`, `"b"`, `"c"`} {
		if !strings.Contains(body, key) {
			t.Errorf("list missing key %s in %s", key, body)
		}
	}
}

func TestStorageHandler_ListWithPrefix(t *testing.T) {
	router := newStorageRouter(t)

	for _, key := range []string{"user:1", "user:2", "config:x"} {
		req := httptest.NewRequest("PUT", "/api/storage/slug/"+key, strings.NewReader(`"v"`))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
	}

	req := httptest.NewRequest("GET", "/api/storage/slug/?prefix=user:", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "user:1") || !strings.Contains(body, "user:2") {
		t.Errorf("missing user entries in %s", body)
	}
	if strings.Contains(body, "config:x") {
		t.Errorf("should not contain config:x in %s", body)
	}
}

func TestStorageHandler_ListEmpty(t *testing.T) {
	router := newStorageRouter(t)
	req := httptest.NewRequest("GET", "/api/storage/empty/", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "[]") {
		t.Errorf("want empty array, got %s", w.Body.String())
	}
}

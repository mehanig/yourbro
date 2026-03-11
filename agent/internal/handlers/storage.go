package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/agent/internal/storage"
)

type contextKey string

const (
	ctxKeyID         contextKey = "key_id"
	ctxIdentityEmail contextKey = "identity_email"
	ctxAccessCode    contextKey = "access_code"
)

// WithKeyID returns a new context with the given key ID.
func WithKeyID(ctx context.Context, keyID string) context.Context {
	return context.WithValue(ctx, ctxKeyID, keyID)
}

// KeyIDFromRequest extracts the key ID set by the relay router.
func KeyIDFromRequest(r *http.Request) string {
	v, _ := r.Context().Value(ctxKeyID).(string)
	return v
}

// WithIdentityEmail returns a new context with the verified email from an identity token.
func WithIdentityEmail(ctx context.Context, email string) context.Context {
	return context.WithValue(ctx, ctxIdentityEmail, email)
}

// IdentityEmailFromRequest extracts the verified email set by the relay router.
func IdentityEmailFromRequest(r *http.Request) string {
	v, _ := r.Context().Value(ctxIdentityEmail).(string)
	return v
}

// WithAccessCode returns a new context with the access code from the relay request.
func WithAccessCode(ctx context.Context, code string) context.Context {
	return context.WithValue(ctx, ctxAccessCode, code)
}

// AccessCodeFromRequest extracts the access code set by the relay router.
func AccessCodeFromRequest(r *http.Request) string {
	v, _ := r.Context().Value(ctxAccessCode).(string)
	return v
}

type StorageHandler struct {
	DB *storage.DB
}

func (h *StorageHandler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	key := chi.URLParam(r, "key")

	entry, err := h.DB.Get(slug, key)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}

	writeJSON(w, http.StatusOK, entry)
}

func (h *StorageHandler) Set(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	key := chi.URLParam(r, "key")

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	// Validate JSON
	if !json.Valid(body) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	if err := h.DB.Set(slug, key, string(body)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to set value"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *StorageHandler) List(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	prefix := r.URL.Query().Get("prefix")

	entries, err := h.DB.List(slug, prefix)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list keys"})
		return
	}
	if entries == nil {
		entries = []storage.Entry{}
	}

	writeJSON(w, http.StatusOK, entries)
}

func (h *StorageHandler) Delete(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	key := chi.URLParam(r, "key")

	if err := h.DB.Delete(slug, key); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete key"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/mehanig/yourbro/agent/internal/storage"
)

// PageStorageHandler serves /api/page-storage/* endpoints.
// No auth middleware — requests arrive pre-authenticated via E2E encrypted relay.
// Slug is provided in the request body (not URL), hardcoded by shell.html.
type PageStorageHandler struct {
	DB *storage.DB
}

type pageStorageRequest struct {
	Slug   string          `json:"slug"`
	Key    string          `json:"key,omitempty"`
	Value  json.RawMessage `json:"value,omitempty"`
	Prefix string          `json:"prefix,omitempty"`
}

func (h *PageStorageHandler) parseRequest(r *http.Request) (*pageStorageRequest, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var req pageStorageRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, err
	}
	return &req, nil
}

func (h *PageStorageHandler) Get(w http.ResponseWriter, r *http.Request) {
	req, err := h.parseRequest(r)
	if err != nil || req.Slug == "" || req.Key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "slug and key are required"})
		return
	}

	entry, err := h.DB.Get(req.Slug, req.Key)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}

	writeJSON(w, http.StatusOK, entry)
}

func (h *PageStorageHandler) Set(w http.ResponseWriter, r *http.Request) {
	req, err := h.parseRequest(r)
	if err != nil || req.Slug == "" || req.Key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "slug and key are required"})
		return
	}

	if len(req.Value) == 0 || !json.Valid(req.Value) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "value must be valid JSON"})
		return
	}

	if err := h.DB.Set(req.Slug, req.Key, string(req.Value)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to set value"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *PageStorageHandler) List(w http.ResponseWriter, r *http.Request) {
	req, err := h.parseRequest(r)
	if err != nil || req.Slug == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "slug is required"})
		return
	}

	entries, err := h.DB.List(req.Slug, req.Prefix)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list keys"})
		return
	}
	if entries == nil {
		entries = []storage.Entry{}
	}

	writeJSON(w, http.StatusOK, entries)
}

func (h *PageStorageHandler) Delete(w http.ResponseWriter, r *http.Request) {
	req, err := h.parseRequest(r)
	if err != nil || req.Slug == "" || req.Key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "slug and key are required"})
		return
	}

	if err := h.DB.Delete(req.Slug, req.Key); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete key"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

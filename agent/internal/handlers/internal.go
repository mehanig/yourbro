package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/agent/internal/storage"
)

const pagesDir = "/data/yourbro/pages"

var validSlug = regexp.MustCompile(`^[a-z0-9-]+$`)

type InternalHandler struct {
	DB *storage.DB
}

type registerRequest struct {
	Title string `json:"title"`
}

func (h *InternalHandler) Register(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !validSlug.MatchString(slug) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid slug: must match [a-z0-9-]+"})
		return
	}

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	filePath := filepath.Join(pagesDir, slug+".html")

	// Verify file exists on disk
	if _, err := os.Stat(filePath); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file not found: " + filePath})
		return
	}

	if err := h.DB.UpsertPage(slug, req.Title, filePath); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to register page"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "slug": slug, "file_path": filePath})
}

func (h *InternalHandler) Delete(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !validSlug.MatchString(slug) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid slug: must match [a-z0-9-]+"})
		return
	}

	if err := h.DB.DeletePage(slug); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete page"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

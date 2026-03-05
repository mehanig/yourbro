package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/agent/internal/storage"
)

type PagesHandler struct {
	DB *storage.DB
}

func (h *PagesHandler) List(w http.ResponseWriter, r *http.Request) {
	pages, err := h.DB.ListPages()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list pages"})
		return
	}
	if pages == nil {
		pages = []storage.PageSummary{}
	}
	writeJSON(w, http.StatusOK, pages)
}

func (h *PagesHandler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	page, err := h.DB.GetPage(slug)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

	writeJSON(w, http.StatusOK, page)
}

func (h *PagesHandler) Upsert(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20)) // 5MB limit for HTML
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	var req struct {
		Title       string `json:"title"`
		HTMLContent string `json:"html_content"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	if req.HTMLContent == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "html_content is required"})
		return
	}
	if req.Title == "" {
		req.Title = slug
	}

	if err := h.DB.UpsertPage(slug, req.Title, req.HTMLContent); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save page"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "slug": slug})
}

func (h *PagesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	if err := h.DB.DeletePage(slug); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete page"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

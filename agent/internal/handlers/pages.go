package handlers

import (
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


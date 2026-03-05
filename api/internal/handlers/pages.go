package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/api/internal/storage"
)

type PagesHandler struct {
	DB *storage.DB
}

// PageAgents returns agent IDs for a given username.
// Used by the static page shell to discover agents without server-side rendering.
func (h *PagesHandler) PageAgents(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")

	user, err := h.DB.GetUserByUsername(r.Context(), username)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}

	agents, err := h.DB.ListAgents(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list agents"})
		return
	}

	var ids []int64
	for _, a := range agents {
		ids = append(ids, a.ID)
	}
	if ids == nil {
		ids = []int64{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"agent_ids": ids})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/storage"
)

type AgentsHandler struct {
	DB     *storage.DB
	Broker *SSEBroker
	Hub    interface{ IsOnline(string) bool } // relay.Hub
}

func (h *AgentsHandler) Register(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req models.RegisterAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	agent, err := h.DB.CreateAgent(r.Context(), userID, req.Name, req.UUID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to register agent"})
		return
	}

	writeJSON(w, http.StatusCreated, agent)
}

func (h *AgentsHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	agents, err := h.DB.ListAgents(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list agents"})
		return
	}
	if agents == nil {
		agents = []models.Agent{}
	}

	// Build response with online status and X25519 public keys
	type agentResp struct {
		models.Agent
		X25519Public string `json:"x25519_public,omitempty"`
	}
	resp := make([]agentResp, len(agents))
	for i, a := range agents {
		if h.Hub != nil {
			a.IsOnline = h.Hub.IsOnline(a.ID)
		}
		resp[i] = agentResp{Agent: a}
		if len(a.X25519PubKey) > 0 {
			resp[i].X25519Public = base64.RawURLEncoding.EncodeToString(a.X25519PubKey)
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *AgentsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id") // UUID string
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid agent id"})
		return
	}

	userID := middleware.GetUserID(r)
	if err := h.DB.DeleteAgent(r.Context(), id, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete agent"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

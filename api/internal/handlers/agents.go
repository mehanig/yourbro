package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/storage"
)

type AgentsHandler struct {
	DB     *storage.DB
	Broker *SSEBroker
}

func (h *AgentsHandler) Register(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req models.RegisterAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Endpoint == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "endpoint is required"})
		return
	}

	agent, err := h.DB.CreateAgent(r.Context(), userID, req.Name, req.Endpoint)
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

	writeJSON(w, http.StatusOK, agents)
}

func (h *AgentsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
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

func (h *AgentsHandler) Heartbeat(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req models.HeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Endpoint == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "endpoint is required"})
		return
	}

	if err := h.DB.UpdateHeartbeat(r.Context(), userID, req.Endpoint); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}

	if h.Broker != nil {
		h.Broker.NotifyUser(userID)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

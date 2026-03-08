package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
)

// RelayBackend abstracts the relay hub for testability.
type RelayBackend interface {
	GetAgentByUUID(ctx context.Context, uuid string) (*models.Agent, error)
	IsOnline(agentUUID string) bool
	SendRequest(ctx context.Context, agentUUID string, req models.RelayRequest) (models.RelayResponse, error)
}

type RelayHandler struct {
	Backend RelayBackend
}

// Relay handles POST /api/relay/{agent_id} — forwards a request to an agent via WebSocket.
func (h *RelayHandler) Relay(w http.ResponseWriter, r *http.Request) {
	agentUUID := chi.URLParam(r, "agent_id") // UUID string
	if agentUUID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid agent_id"})
		return
	}

	userID := middleware.GetUserID(r)

	// Verify the user owns this agent
	agent, err := h.Backend.GetAgentByUUID(r.Context(), agentUUID)
	if err != nil || agent.UserID != userID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}

	// Check agent is connected
	if !h.Backend.IsOnline(agentUUID) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent offline"})
		return
	}

	// Parse relay request
	var req models.RelayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.ID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id is required"})
		return
	}
	// Encrypted requests carry method/path inside the encrypted payload — only require id
	if !req.Encrypted && (req.Method == "" || req.Path == "") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id, method, and path are required"})
		return
	}

	// Forward to agent with 5s timeout
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	resp, err := h.Backend.SendRequest(ctx, agentUUID, req)
	if err != nil {
		writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": "relay timeout or agent error"})
		return
	}

	// Always return the full JSON envelope — relay is just a pipe
	writeJSON(w, http.StatusOK, resp)
}

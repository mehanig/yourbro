package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/protocol/wire"
)

// mockRelayBackend implements RelayBackend for testing.
type mockRelayBackend struct {
	agents map[string]*models.Agent // uuid → agent
	online map[string]bool          // uuid → is online
}

func (m *mockRelayBackend) GetAgentByUUID(_ context.Context, uuid string) (*models.Agent, error) {
	a, ok := m.agents[uuid]
	if !ok {
		return nil, fmt.Errorf("not found")
	}
	return a, nil
}

func (m *mockRelayBackend) IsOnline(agentUUID string) bool {
	return m.online[agentUUID]
}

func (m *mockRelayBackend) SendRequest(_ context.Context, _ string, req wire.RelayRequest) (wire.RelayResponse, error) {
	body := `{"status":"ok"}`
	return wire.RelayResponse{ID: req.ID, Status: 200, Body: &body}, nil
}

func TestRelay_OtherUserCannotRelayToAgent(t *testing.T) {
	const agentUUID = "agent-uuid-001"
	const ownerID int64 = 1
	const attackerID int64 = 2

	backend := &mockRelayBackend{
		agents: map[string]*models.Agent{
			agentUUID: {ID: agentUUID, UserID: ownerID, Name: "my-agent"},
		},
		online: map[string]bool{agentUUID: true},
	}

	handler := &RelayHandler{Backend: backend}
	r := chi.NewRouter()
	r.Post("/api/relay/{agent_id}", handler.Relay)

	makeRequest := func(userID int64) *httptest.ResponseRecorder {
		body, _ := json.Marshal(wire.RelayRequest{
			ID:        "req-1",
			Encrypted: true,
			KeyID:     "test-key-id",
			Payload:   "dGVzdA==",
		})
		req := httptest.NewRequest("POST", "/api/relay/"+agentUUID, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}

	// Attacker tries to relay to owner's agent — must be denied
	rec := makeRequest(attackerID)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("attacker should get 404, got %d: %s", rec.Code, rec.Body.String())
	}

	// Owner relays to their own agent — should succeed
	rec = makeRequest(ownerID)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner should get 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRelay_NonexistentAgent(t *testing.T) {
	backend := &mockRelayBackend{
		agents: map[string]*models.Agent{},
		online: map[string]bool{},
	}

	handler := &RelayHandler{Backend: backend}
	r := chi.NewRouter()
	r.Post("/api/relay/{agent_id}", handler.Relay)

	body, _ := json.Marshal(wire.RelayRequest{
		ID:        "req-2",
		Encrypted: true,
		KeyID:     "test-key-id",
		Payload:   "dGVzdA==",
	})
	req := httptest.NewRequest("POST", "/api/relay/nonexistent-uuid", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, int64(1)))

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("nonexistent agent should get 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRelay_OfflineAgent(t *testing.T) {
	const agentUUID = "agent-uuid-002"
	const ownerID int64 = 1

	backend := &mockRelayBackend{
		agents: map[string]*models.Agent{
			agentUUID: {ID: agentUUID, UserID: ownerID, Name: "offline-agent"},
		},
		online: map[string]bool{agentUUID: false},
	}

	handler := &RelayHandler{Backend: backend}
	r := chi.NewRouter()
	r.Post("/api/relay/{agent_id}", handler.Relay)

	body, _ := json.Marshal(wire.RelayRequest{
		ID:        "req-3",
		Encrypted: true,
		KeyID:     "test-key-id",
		Payload:   "dGVzdA==",
	})
	req := httptest.NewRequest("POST", "/api/relay/"+agentUUID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, ownerID))

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("offline agent should get 503, got %d: %s", rec.Code, rec.Body.String())
	}
}

package relay

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/storage"
)

// Hub manages WebSocket connections from relay-mode agents.
type Hub struct {
	mu     sync.RWMutex
	agents map[int64]*AgentConn // agentID → connection

	DB     *storage.DB
	Notify func(userID int64) // called when agent status changes (SSE broker)
}

// AgentConn represents a connected relay-mode agent.
type AgentConn struct {
	ws      *websocket.Conn
	userID  int64
	agentID int64

	mu      sync.Mutex
	pending map[string]chan models.RelayResponse // requestID → response channel
}

func NewHub(db *storage.DB, notify func(userID int64)) *Hub {
	return &Hub{
		agents: make(map[int64]*AgentConn),
		DB:     db,
		Notify: notify,
	}
}

// IsOnline checks if an agent is connected via WebSocket.
func (h *Hub) IsOnline(agentID int64) bool {
	h.mu.RLock()
	_, ok := h.agents[agentID]
	h.mu.RUnlock()
	return ok
}

// HandleAgentWS upgrades an HTTP connection to a WebSocket for an agent.
// Called from the route handler after authentication.
func (h *Hub) HandleAgentWS(w http.ResponseWriter, r *http.Request, userID int64, agentName string) {
	// Find or create agent record
	agent, err := h.DB.GetAgentByUserAndName(r.Context(), userID, agentName)
	if err != nil {
		// Create a new relay-mode agent
		agent, err = h.DB.CreateAgent(r.Context(), userID, agentName, nil)
		if err != nil {
			http.Error(w, "failed to register agent", http.StatusInternalServerError)
			return
		}
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// No origin check needed — agents authenticate via Bearer token
	})
	if err != nil {
		log.Printf("WebSocket accept failed: %v", err)
		return
	}
	conn.SetReadLimit(2 * 1024 * 1024) // 2MB

	ac := &AgentConn{
		ws:      conn,
		userID:  userID,
		agentID: agent.ID,
		pending: make(map[string]chan models.RelayResponse),
	}

	// Register connection
	h.mu.Lock()
	h.agents[agent.ID] = ac
	h.mu.Unlock()

	// Update heartbeat and notify SSE
	_ = h.DB.UpdateHeartbeatByID(r.Context(), agent.ID)
	if h.Notify != nil {
		h.Notify(userID)
	}

	log.Printf("Agent %d (%s) connected via WebSocket", agent.ID, agentName)

	// Read loop — receives responses from agent
	h.readLoop(ac)

	// Cleanup on disconnect
	h.mu.Lock()
	delete(h.agents, agent.ID)
	h.mu.Unlock()

	// Drain pending requests with error
	ac.mu.Lock()
	for id, ch := range ac.pending {
		ch <- models.RelayResponse{
			ID:     id,
			Status: 503,
			Headers: map[string]string{"Content-Type": "application/json"},
			Body:   strPtr(`{"error":"agent disconnected"}`),
		}
		close(ch)
	}
	ac.pending = nil
	ac.mu.Unlock()

	if h.Notify != nil {
		h.Notify(userID)
	}
	log.Printf("Agent %d (%s) disconnected", agent.ID, agentName)
}

// readLoop reads WebSocket messages from the agent (responses to relay requests).
func (h *Hub) readLoop(ac *AgentConn) {
	ctx := context.Background()
	for {
		var msg models.WireMessage
		err := wsjson.Read(ctx, ac.ws, &msg)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				// Normal close or error — both end the loop
			}
			return
		}

		if msg.Type != "response" {
			continue
		}

		var resp models.RelayResponse
		if err := json.Unmarshal(msg.Payload, &resp); err != nil {
			log.Printf("Agent %d: bad response payload: %v", ac.agentID, err)
			continue
		}
		resp.ID = msg.ID

		ac.mu.Lock()
		ch, ok := ac.pending[msg.ID]
		if ok {
			delete(ac.pending, msg.ID)
		}
		ac.mu.Unlock()

		if ok {
			ch <- resp
		}
	}
}

// SendRequest sends a relay request to an agent and waits for the response.
func (h *Hub) SendRequest(ctx context.Context, agentID int64, req models.RelayRequest) (models.RelayResponse, error) {
	h.mu.RLock()
	ac, ok := h.agents[agentID]
	h.mu.RUnlock()
	if !ok {
		return models.RelayResponse{}, errors.New("agent not connected")
	}

	// Create response channel
	ch := make(chan models.RelayResponse, 1)
	ac.mu.Lock()
	if ac.pending == nil {
		ac.mu.Unlock()
		return models.RelayResponse{}, errors.New("agent disconnected")
	}
	ac.pending[req.ID] = ch
	ac.mu.Unlock()

	// Marshal request payload
	payload, err := json.Marshal(req)
	if err != nil {
		ac.mu.Lock()
		delete(ac.pending, req.ID)
		ac.mu.Unlock()
		return models.RelayResponse{}, err
	}

	// Send to agent
	msg := models.WireMessage{
		Version: 1,
		Type:    "request",
		ID:      req.ID,
		Payload: payload,
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := wsjson.Write(writeCtx, ac.ws, msg); err != nil {
		ac.mu.Lock()
		delete(ac.pending, req.ID)
		ac.mu.Unlock()
		return models.RelayResponse{}, err
	}

	// Wait for response with timeout
	select {
	case resp := <-ch:
		return resp, nil
	case <-ctx.Done():
		ac.mu.Lock()
		delete(ac.pending, req.ID)
		ac.mu.Unlock()
		return models.RelayResponse{}, ctx.Err()
	}
}

func strPtr(s string) *string {
	return &s
}

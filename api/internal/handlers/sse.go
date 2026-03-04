package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/storage"
)

// SSEBroker manages per-user SSE connections and broadcasts agent status updates.
type SSEBroker struct {
	DB *storage.DB

	mu        sync.Mutex
	clients   map[int64]map[chan []byte]struct{} // userID -> set of channels
	lastState map[int64]map[int64]bool           // userID -> agentID -> was_online
}

func NewSSEBroker(db *storage.DB) *SSEBroker {
	return &SSEBroker{
		DB:        db,
		clients:   make(map[int64]map[chan []byte]struct{}),
		lastState: make(map[int64]map[int64]bool),
	}
}

func (b *SSEBroker) subscribe(userID int64) chan []byte {
	ch := make(chan []byte, 4)
	b.mu.Lock()
	if b.clients[userID] == nil {
		b.clients[userID] = make(map[chan []byte]struct{})
	}
	b.clients[userID][ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *SSEBroker) unsubscribe(userID int64, ch chan []byte) {
	b.mu.Lock()
	delete(b.clients[userID], ch)
	if len(b.clients[userID]) == 0 {
		delete(b.clients, userID)
		delete(b.lastState, userID)
	}
	b.mu.Unlock()
	close(ch)
}

// NotifyUser fetches the current agent list for a user and sends it to all their SSE clients.
func (b *SSEBroker) NotifyUser(userID int64) {
	b.mu.Lock()
	subs := b.clients[userID]
	if len(subs) == 0 {
		b.mu.Unlock()
		return
	}
	b.mu.Unlock()

	b.sendAgents(userID)
}

func (b *SSEBroker) sendAgents(userID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	agents, err := b.DB.ListAgents(ctx, userID)
	if err != nil {
		log.Printf("SSE: failed to list agents for user %d: %v", userID, err)
		return
	}
	if agents == nil {
		agents = []models.Agent{}
	}

	data, err := json.Marshal(agents)
	if err != nil {
		return
	}

	b.mu.Lock()
	// Update last known state
	state := make(map[int64]bool, len(agents))
	for _, a := range agents {
		state[a.ID] = a.IsOnline
	}
	b.lastState[userID] = state

	for ch := range b.clients[userID] {
		select {
		case ch <- data:
		default:
		}
	}
	b.mu.Unlock()
}

// StartStaleChecker detects agents that just went offline and notifies only those users.
func (b *SSEBroker) StartStaleChecker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				b.mu.Lock()
				userIDs := make([]int64, 0, len(b.clients))
				for uid := range b.clients {
					userIDs = append(userIDs, uid)
				}
				b.mu.Unlock()

				for _, uid := range userIDs {
					b.checkAndNotifyIfChanged(uid)
				}
			}
		}
	}()
}

// checkAndNotifyIfChanged only sends an SSE event if any agent's online state changed.
func (b *SSEBroker) checkAndNotifyIfChanged(userID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	agents, err := b.DB.ListAgents(ctx, userID)
	if err != nil {
		return
	}

	b.mu.Lock()
	prev := b.lastState[userID]
	changed := false

	for _, a := range agents {
		wasOnline, existed := prev[a.ID]
		if !existed || wasOnline != a.IsOnline {
			changed = true
			break
		}
	}
	// Also check if agents were removed
	if len(agents) != len(prev) {
		changed = true
	}
	b.mu.Unlock()

	if changed {
		b.sendAgents(userID)
	}
}

// ServeHTTP handles GET /api/agents/stream — SSE endpoint.
func (b *SSEBroker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	userID := middleware.GetUserID(r)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := b.subscribe(userID)
	defer b.unsubscribe(userID, ch)

	// Send current state immediately
	b.sendAgents(userID)

	for {
		select {
		case <-r.Context().Done():
			return
		case data, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

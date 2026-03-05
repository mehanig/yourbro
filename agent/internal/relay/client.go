package relay

import (
	"context"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// WireMessage is the WebSocket wire protocol envelope.
type WireMessage struct {
	Version int             `json:"v"`
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Payload json.RawMessage `json:"payload"`
}

// Request is the relay request payload (server → agent).
type Request struct {
	ID      string            `json:"id"`
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    *string           `json:"body"`
}

// Response is the relay response payload (agent → server).
type Response struct {
	ID      string            `json:"id"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    *string           `json:"body"`
}

// Client manages the WebSocket connection to the yourbro server.
type Client struct {
	ServerURL  string // wss://yourbro.ai or https://yourbro.ai
	APIToken   string
	AgentName  string
	Handler    func(ctx context.Context, req Request) Response
}

// Run connects to the server and processes relay messages. It reconnects
// automatically with exponential backoff on disconnection.
func (c *Client) Run(ctx context.Context) {
	backoff := time.Second
	maxBackoff := 60 * time.Second

	for {
		err := c.connect(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			log.Printf("WebSocket disconnected: %v", err)
		}

		// Exponential backoff with 10% jitter
		jitter := time.Duration(float64(backoff) * 0.1 * (rand.Float64()*2 - 1))
		sleep := backoff + jitter
		log.Printf("Reconnecting in %s...", sleep.Round(time.Millisecond))

		select {
		case <-time.After(sleep):
		case <-ctx.Done():
			return
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func (c *Client) connect(ctx context.Context) error {
	// Convert server URL to WebSocket URL
	wsURL := c.ServerURL
	wsURL = strings.TrimRight(wsURL, "/")
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	wsURL += "/ws/agent?name=" + c.AgentName

	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(dialCtx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Authorization": {"Bearer " + c.APIToken},
		},
	})
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(2 * 1024 * 1024) // 2MB

	log.Printf("Connected to relay server: %s", wsURL)

	// Reset backoff on successful connection (caller handles this by resetting)

	// Read loop
	for {
		var msg WireMessage
		err := wsjson.Read(ctx, conn, &msg)
		if err != nil {
			return err
		}

		if msg.Type != "request" {
			continue
		}

		var req Request
		if err := json.Unmarshal(msg.Payload, &req); err != nil {
			log.Printf("Bad relay request: %v", err)
			continue
		}
		req.ID = msg.ID

		// Handle request in goroutine (don't block read loop)
		go func() {
			resp := c.Handler(ctx, req)
			resp.ID = req.ID

			payload, err := json.Marshal(resp)
			if err != nil {
				log.Printf("Failed to marshal response: %v", err)
				return
			}

			respMsg := WireMessage{
				Version: 1,
				Type:    "response",
				ID:      req.ID,
				Payload: payload,
			}

			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			if err := wsjson.Write(writeCtx, conn, respMsg); err != nil {
				log.Printf("Failed to send response: %v", err)
			}
		}()
	}
}

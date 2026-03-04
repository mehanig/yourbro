package handlers

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/mehanig/yourbro/agent/internal/storage"
)

type PairHandler struct {
	DB            *storage.DB
	PairingCode   string
	PairingExpiry time.Time

	mu       sync.Mutex
	attempts int
	used     bool
}

type pairRequest struct {
	PairingCode   string `json:"pairing_code"`
	UserPublicKey string `json:"user_public_key"`
	Username      string `json:"username"`
}

// Pair handles POST /api/pair.
// The pairing code is the sole auth mechanism — rate-limited, one-time use, 5-min expiry.
func (h *PairHandler) Pair(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Check if already used
	if h.used {
		writeJSON(w, http.StatusGone, map[string]string{"error": "pairing code already used"})
		return
	}

	// Check expiry
	if time.Now().After(h.PairingExpiry) {
		writeJSON(w, http.StatusGone, map[string]string{"error": "pairing code expired"})
		return
	}

	// Rate limit: max 5 attempts
	if h.attempts >= 5 {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many pairing attempts"})
		return
	}
	h.attempts++

	// Read body with size limit (4KB)
	body, err := io.ReadAll(io.LimitReader(r.Body, 4096))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	var req pairRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	// Constant-time comparison of pairing code
	if subtle.ConstantTimeCompare([]byte(req.PairingCode), []byte(h.PairingCode)) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid pairing code"})
		return
	}

	// Validate public key: must be base64-encoded 32-byte Ed25519 key
	pubKeyBytes, err := base64.RawURLEncoding.DecodeString(req.UserPublicKey)
	if err != nil || len(pubKeyBytes) != 32 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid public key: must be base64url-encoded 32-byte Ed25519 key"})
		return
	}

	if req.Username == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username is required"})
		return
	}

	// Store authorized key
	if err := h.DB.AddAuthorizedKey(req.UserPublicKey, req.Username); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to store key"})
		return
	}

	// Mark code as used (one-time)
	h.used = true

	writeJSON(w, http.StatusOK, map[string]string{"status": "paired"})
}

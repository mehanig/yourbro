package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/mehanig/yourbro/api/internal/auth"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/storage"
)

// IdentityHandler serves identity tokens and JWKS.
type IdentityHandler struct {
	Signer *auth.IdentitySigner
	DB     *storage.DB
}

// GetToken returns a short-lived Ed25519-signed JWT with the caller's email.
// GET /api/identity-token (requires auth)
func (h *IdentityHandler) GetToken(w http.ResponseWriter, r *http.Request) {
	if h.Signer == nil {
		http.Error(w, `{"error":"identity tokens not configured"}`, http.StatusServiceUnavailable)
		return
	}

	userID := middleware.GetUserID(r)
	user, err := h.DB.GetUserByID(r.Context(), userID)
	if err != nil {
		http.Error(w, `{"error":"user not found"}`, http.StatusNotFound)
		return
	}

	token, err := h.Signer.SignIdentityToken(user.Email, user.Username, user.ID)
	if err != nil {
		http.Error(w, `{"error":"failed to sign token"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// JWKS returns the Ed25519 public key in JWKS format (RFC 7517).
// GET /.well-known/jwks.json (public, no auth)
func (h *IdentityHandler) JWKS(w http.ResponseWriter, r *http.Request) {
	if h.Signer == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		json.NewEncoder(w).Encode(map[string]interface{}{"keys": []interface{}{}})
		return
	}

	pubB64url := base64.RawURLEncoding.EncodeToString(h.Signer.PublicKeyBytes())

	key := map[string]string{
		"kty": "OKP",
		"crv": "Ed25519",
		"x":   pubB64url,
		"kid": h.Signer.KeyID,
		"use": "sig",
		"alg": "EdDSA",
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	json.NewEncoder(w).Encode(map[string]interface{}{"keys": []interface{}{key}})
}

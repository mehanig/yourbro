package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/mehanig/yourbro/api/internal/auth"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/storage"
)

type contextKey string

const (
	UserIDKey contextKey = "user_id"
	TokenKey  contextKey = "token"
	UserKey   contextKey = "user"
)

// RequireAuth checks for a valid session cookie or Bearer token (API token).
// Browser requests use httpOnly cookie; agent/API requests use Bearer token.
func RequireAuth(db *storage.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Primary: httpOnly session cookie (browser requests)
			header := ""
			if cookie, err := r.Cookie("yb_session"); err == nil {
				header = "Bearer " + cookie.Value
			}
			// Fallback: Authorization header (API tokens, agents)
			if header == "" {
				header = r.Header.Get("Authorization")
			}
			if header == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				http.Error(w, `{"error":"invalid authorization format"}`, http.StatusUnauthorized)
				return
			}
			tokenStr := parts[1]

			// Try API token first (starts with yb_)
			if strings.HasPrefix(tokenStr, "yb_") {
				hash := auth.HashToken(tokenStr)
				token, err := db.GetTokenByHash(r.Context(), hash)
				if err != nil {
					http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
					return
				}
				ctx := context.WithValue(r.Context(), UserIDKey, token.UserID)
				ctx = context.WithValue(ctx, TokenKey, token)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Try JWT session token
			claims, err := auth.ValidateSessionToken(tokenStr)
			if err != nil {
				http.Error(w, `{"error":"invalid session token"}`, http.StatusUnauthorized)
				return
			}
			// Check if session was revoked (logout)
			tokenHash := auth.HashToken(tokenStr)
			if db.IsSessionRevoked(r.Context(), tokenHash) {
				http.Error(w, `{"error":"session revoked"}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireScope checks that the API token has the required scope.
func RequireScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := r.Context().Value(TokenKey).(*models.Token)
			if !ok {
				// Session-based auth (JWT) — has all scopes
				next.ServeHTTP(w, r)
				return
			}
			for _, s := range token.Scopes {
				if s == scope {
					next.ServeHTTP(w, r)
					return
				}
			}
			http.Error(w, `{"error":"insufficient scope"}`, http.StatusForbidden)
		})
	}
}

// GetUserID extracts the user ID from the request context.
func GetUserID(r *http.Request) int64 {
	id, _ := r.Context().Value(UserIDKey).(int64)
	return id
}

package middleware

import (
	"crypto/subtle"
	"net/http"
)

// RequireInternalKey returns middleware that validates the X-YourBro-Internal-Key header
// against the provided key. Returns 401 on mismatch.
func RequireInternalKey(key string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			provided := r.Header.Get("X-YourBro-Internal-Key")
			if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(key)) != 1 {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

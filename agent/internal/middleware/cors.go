package middleware

import (
	"github.com/go-chi/cors"
)

// CORSForYourbro returns CORS options allowing yourbro.ai origins.
func CORSForYourbro() cors.Options {
	return cors.Options{
		// "null" origin comes from sandboxed iframes (sandbox="allow-scripts" without allow-same-origin)
		AllowedOrigins:   []string{"https://yourbro.ai", "http://localhost:5173", "http://localhost", "null"},
		AllowedMethods:   []string{"GET", "PUT", "DELETE", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}
}

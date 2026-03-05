package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"golang.org/x/oauth2"

	"github.com/mehanig/yourbro/api/internal/auth"
	"github.com/mehanig/yourbro/api/internal/handlers"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/relay"
	"github.com/mehanig/yourbro/api/internal/storage"
)

//go:embed sdk/clawd-storage.js
var sdkScript string

//go:embed migrations/*.sql
var migrationFiles embed.FS

func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	// Create tracking table
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	// Sort by filename to ensure order
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		// Skip already-applied migrations
		var applied bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, entry.Name()).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", entry.Name(), err)
		}
		if applied {
			log.Printf("Skipping migration (already applied): %s", entry.Name())
			continue
		}

		data, err := migrationFiles.ReadFile(filepath.Join("migrations", entry.Name()))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		log.Printf("Running migration: %s", entry.Name())
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			return fmt.Errorf("execute migration %s: %w", entry.Name(), err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, entry.Name()); err != nil {
			return fmt.Errorf("record migration %s: %w", entry.Name(), err)
		}
	}
	return nil
}

func main() {
	_ = godotenv.Load()

	// Handle migrate subcommand
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		ctx := context.Background()
		dbURL := getEnv("DATABASE_URL", "postgres://yourbro:yourbro@localhost:5432/yourbro?sslmode=disable")
		pool, err := pgxpool.New(ctx, dbURL)
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer pool.Close()
		if err := runMigrations(ctx, pool); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
		log.Println("Migrations completed successfully")
		return
	}

	ctx := context.Background()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://yourbro:yourbro@localhost:5432/yourbro?sslmode=disable"
	}

	db, err := storage.NewDB(ctx, dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	log.Printf("Loaded SDK script (%d bytes)", len(sdkScript))

	oauthCfg := auth.NewGoogleOAuthConfig()
	keysHandler := &handlers.KeysHandler{DB: db}
	sseBroker := handlers.NewSSEBroker(db)
	sseBroker.StartStaleChecker(context.Background())
	relayHub := relay.NewHub(db, sseBroker.NotifyUser)
	sseBroker.Hub = relayHub
	agentsHandler := &handlers.AgentsHandler{DB: db, Broker: sseBroker, Hub: relayHub}
	relayHandler := &handlers.RelayHandler{Hub: relayHub}
	pagesHandler := &handlers.PagesHandler{
		DB:        db,
		Hub:       relayHub,
		SDKScript: sdkScript,
	}

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RealIP)
	frontendURL := getEnv("FRONTEND_URL", "http://localhost:5173")
	r.Use(cors.Handler(cors.Options{
		// "null" origin comes from sandboxed iframes (sandbox="allow-scripts" without allow-same-origin)
		AllowedOrigins:   []string{frontendURL, "null"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           86400,
	}))

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// OAuth routes
	r.Get("/auth/google", func(w http.ResponseWriter, r *http.Request) {
		state, err := auth.GenerateRandomHex(16)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		// Store state in short-lived httpOnly cookie for CSRF validation
		http.SetCookie(w, &http.Cookie{
			Name:     "oauth_state",
			Value:    state,
			Path:     "/auth/google/callback",
			HttpOnly: true,
			Secure:   getEnv("COOKIE_DOMAIN", "") != "",
			SameSite: http.SameSiteLaxMode,
			MaxAge:   300, // 5 minutes
		})
		url := oauthCfg.AuthCodeURL(state, oauth2.SetAuthURLParam("prompt", "select_account"))
		http.Redirect(w, r, url, http.StatusTemporaryRedirect)
	})

	r.Get("/auth/google/callback", func(w http.ResponseWriter, r *http.Request) {
		// Validate CSRF state
		stateCookie, err := r.Cookie("oauth_state")
		if err != nil || stateCookie.Value == "" {
			http.Error(w, "missing state cookie", http.StatusBadRequest)
			return
		}
		if r.URL.Query().Get("state") != stateCookie.Value {
			http.Error(w, "invalid state parameter", http.StatusBadRequest)
			return
		}
		// Clear state cookie
		http.SetCookie(w, &http.Cookie{
			Name:   "oauth_state",
			Value:  "",
			Path:   "/auth/google/callback",
			MaxAge: -1,
		})

		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "missing code", http.StatusBadRequest)
			return
		}

		info, err := auth.GetGoogleUserInfo(r.Context(), oauthCfg, code)
		if err != nil {
			http.Error(w, "OAuth failed: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Derive username from email
		username := info.Email
		if at := len(info.Email); at > 0 {
			for i, c := range info.Email {
				if c == '@' {
					username = info.Email[:i]
					break
				}
			}
		}

		user, err := db.UpsertUser(r.Context(), info.ID, info.Email, username)
		if err != nil {
			http.Error(w, "Failed to create user", http.StatusInternalServerError)
			return
		}

		token, err := auth.CreateSessionToken(user.ID)
		if err != nil {
			http.Error(w, "Failed to create session", http.StatusInternalServerError)
			return
		}

		http.SetCookie(w, sessionCookie(token, 7*24*60*60))

		// Redirect to frontend — session is in httpOnly cookie, no token in URL
		http.Redirect(w, r, frontendURL+"/#/callback", http.StatusTemporaryRedirect)
	})

	// Public page rendering — shell fetches HTML from agent via relay
	r.Get("/p/{username}/{slug}", pagesHandler.RenderPage)

	// Logout — clears httpOnly session cookie (no auth required)
	r.Post("/api/logout", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, sessionCookie("", -1))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// WebSocket endpoint for relay-mode agents (agent auth via Bearer token)
	r.Get("/ws/agent", func(w http.ResponseWriter, r *http.Request) {
		// Authenticate agent via Bearer token
		header := r.Header.Get("Authorization")
		if header == "" {
			http.Error(w, "missing authorization", http.StatusUnauthorized)
			return
		}
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "invalid authorization format", http.StatusUnauthorized)
			return
		}
		tokenStr := parts[1]

		// Validate API token
		hash := auth.HashToken(tokenStr)
		token, err := db.GetTokenByHash(r.Context(), hash)
		if err != nil {
			http.Error(w, "invalid or expired token", http.StatusUnauthorized)
			return
		}

		// Get agent name from query param
		agentName := r.URL.Query().Get("name")
		if agentName == "" {
			agentName = "relay-agent"
		}

		relayHub.HandleAgentWS(w, r, token.UserID, agentName)
	})

	// Authenticated API routes
	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.RequireAuth(db))

		// Short-lived content token for sandboxed iframes (can't send httpOnly cookies)
		r.Get("/content-token", func(w http.ResponseWriter, r *http.Request) {
			userID := middleware.GetUserID(r)
			token, err := auth.CreateSessionToken(userID)
			if err != nil {
				http.Error(w, `{"error":"failed to create token"}`, http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"token": token})
		})

		// User info
		r.Get("/me", func(w http.ResponseWriter, r *http.Request) {
			userID := middleware.GetUserID(r)
			user, err := db.GetUserByID(r.Context(), userID)
			if err != nil {
				http.Error(w, "User not found", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(user)
		})

		// Token management
		r.Post("/tokens", func(w http.ResponseWriter, r *http.Request) {
			userID := middleware.GetUserID(r)
			var req models.CreateTokenRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
				return
			}
			for _, s := range req.Scopes {
				if !models.ValidScopes[s] {
					http.Error(w, fmt.Sprintf(`{"error":"invalid scope: %s"}`, s), http.StatusBadRequest)
					return
				}
			}
			if req.ExpiresIn <= 0 {
				req.ExpiresIn = 90
			}

			tokenStr, err := auth.GenerateAPIToken()
			if err != nil {
				http.Error(w, `{"error":"failed to generate token"}`, http.StatusInternalServerError)
				return
			}
			hash := auth.HashToken(tokenStr)
			expiresAt := time.Now().Add(time.Duration(req.ExpiresIn) * 24 * time.Hour)

			id, err := db.CreateToken(r.Context(), userID, hash, req.Name, req.Scopes, expiresAt)
			if err != nil {
				http.Error(w, `{"error":"failed to create token"}`, http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(models.CreateTokenResponse{
				Token: tokenStr,
				Name:  req.Name,
				ID:    id,
			})
		})

		r.Get("/tokens", func(w http.ResponseWriter, r *http.Request) {
			userID := middleware.GetUserID(r)
			tokens, err := db.ListTokens(r.Context(), userID)
			if err != nil {
				http.Error(w, `{"error":"failed to list tokens"}`, http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(tokens)
		})

		r.Delete("/tokens/{id}", func(w http.ResponseWriter, r *http.Request) {
			userID := middleware.GetUserID(r)
			id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
			if err != nil {
				http.Error(w, `{"error":"invalid token id"}`, http.StatusBadRequest)
				return
			}
			if err := db.DeleteToken(r.Context(), id, userID); err != nil {
				http.Error(w, `{"error":"failed to delete token"}`, http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
		})

		// Page agents — returns agent IDs for a username (used by static page shell)
		r.Get("/page-agents/{username}", pagesHandler.PageAgents)

		// Agents
		r.Route("/agents", func(r chi.Router) {
			r.Post("/", agentsHandler.Register)
			r.Get("/", agentsHandler.List)
			r.Delete("/{id}", agentsHandler.Delete)
		r.Get("/stream", sseBroker.ServeHTTP)
		})

		// Relay — forward requests to relay-mode agents via WebSocket
		r.Post("/relay/{agent_id}", relayHandler.Relay)

		// Public Keys
		r.Route("/keys", func(r chi.Router) {
			r.With(middleware.RequireScope("manage:keys")).Post("/", keysHandler.Create)
			r.Get("/", keysHandler.List)
			r.With(middleware.RequireScope("manage:keys")).Delete("/{id}", keysHandler.Delete)
		})
	})

	port := getEnv("PORT", "8080")
	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("Server starting on :%s", port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// sessionCookie creates a consistent session cookie with cross-subdomain support.
func sessionCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     "yb_session",
		Value:    value,
		Domain:   getEnv("COOKIE_DOMAIN", ""), // "yourbro.ai" in prod, empty for local
		Path:     "/",
		HttpOnly: true,
		Secure:   getEnv("COOKIE_DOMAIN", "") != "", // Secure only when cross-subdomain (production)
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	}
}


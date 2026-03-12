package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
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

	"github.com/mehanig/yourbro/api/internal/analytics"
	"github.com/mehanig/yourbro/api/internal/auth"
	cfclient "github.com/mehanig/yourbro/api/internal/cloudflare"
	"github.com/mehanig/yourbro/api/internal/handlers"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/relay"
	"github.com/mehanig/yourbro/api/internal/storage"
	"github.com/mehanig/yourbro/protocol/wire"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

//go:embed shell.html
var shellHTML string

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

	oauthCfg := auth.NewGoogleOAuthConfig()

	// Initialize Ed25519 identity signer for shared page tokens (optional)
	identitySigner, err := auth.NewIdentitySigner(os.Getenv("IDENTITY_SIGNING_KEY"))
	if err != nil {
		log.Fatalf("Invalid IDENTITY_SIGNING_KEY: %v", err)
	}
	if identitySigner != nil {
		log.Printf("Identity signer initialized (kid=%s)", identitySigner.KeyID)
	} else {
		log.Printf("IDENTITY_SIGNING_KEY not set — identity tokens disabled")
	}
	identityHandler := &handlers.IdentityHandler{Signer: identitySigner, DB: db}

	keysHandler := &handlers.KeysHandler{DB: db}

	// Cloudflare client for Custom Hostnames (optional — nil in dev)
	var cfClient *cfclient.Client
	if cfZoneID := os.Getenv("CF_ZONE_ID"); cfZoneID != "" {
		cfClient = &cfclient.Client{
			ZoneID:   cfZoneID,
			APIToken: os.Getenv("CF_API_TOKEN"),
		}
	}
	customDomainsHandler := &handlers.CustomDomainsHandler{DB: db, CF: cfClient}
	sseBroker := handlers.NewSSEBroker(db)
	sseBroker.StartStaleChecker(context.Background())
	relayHub := relay.NewHub(db, sseBroker.NotifyUser)
	sseBroker.Hub = relayHub
	agentsHandler := &handlers.AgentsHandler{DB: db, Broker: sseBroker, Hub: relayHub}
	relayHandler := &handlers.RelayHandler{Backend: relayHub}
	viewRecorder := analytics.New(db, 256, 4)

	r := chi.NewRouter()

	// Global middleware (non-CORS)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RealIP)

	// Custom domain shell serving: host-based routing middleware.
	// Requests with a Host header that isn't the API domain are served as custom domain pages.
	// Must be registered before any routes.
	apiURL := getEnv("API_URL", "https://api.yourbro.ai")
	apiHost := getEnv("API_HOST", "api.yourbro.ai")
	var validSlugRe = regexp.MustCompile(`^[a-z0-9-]+$`)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := strings.ToLower(r.Host)
			if i := strings.LastIndex(host, ":"); i != -1 {
				host = host[:i]
			}

			// Known API hosts pass through to normal routing
			// "api" and "nginx" are Docker Compose service names used for internal requests
			if host == apiHost || host == "localhost" || host == "127.0.0.1" || host == "api" || host == "nginx" {
				next.ServeHTTP(w, r)
				return
			}

			// Custom domain — look up in DB
			cd, username, err := db.GetCustomDomainByHost(r.Context(), host)
			if err != nil {
				http.NotFound(w, r)
				return
			}

			path := strings.TrimPrefix(r.URL.Path, "/")
			path = strings.TrimSuffix(path, "/")
			slug := path

			if slug == "" {
				if cd.DefaultSlug == "" {
					http.NotFound(w, r)
					return
				}
				slug = cd.DefaultSlug
			}

			if !validSlugRe.MatchString(slug) {
				http.NotFound(w, r)
				return
			}

			apiURLJSON, _ := json.Marshal(apiURL)
			usernameJSON, _ := json.Marshal(username)
			html := shellHTML
			html = strings.Replace(html, "'/*YOURBRO_API_URL*/'", string(apiURLJSON), 1)
			html = strings.Replace(html, "'/*YOURBRO_CUSTOM_USER*/'", string(usernameJSON), 1)

			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "public, max-age=300")
			w.Write([]byte(html))
		})
	})

	frontendURL := getEnv("FRONTEND_URL", "http://localhost:5173")

	// Restrictive CORS for authenticated routes
	authCORS := cors.Handler(cors.Options{
		// "null" origin comes from sandboxed iframes (sandbox="allow-scripts" without allow-same-origin)
		AllowedOrigins:   []string{frontendURL, "null"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Referrer"},
		AllowCredentials: true,
		MaxAge:           86400,
	})

	// Permissive CORS for public-page routes (cookie-free, E2E encrypted)
	publicCORS := cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "X-Referrer"},
		AllowCredentials: false,
		MaxAge:           86400,
	})

	// Health check (no CORS needed)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// JWKS endpoint — public, no auth (agents fetch this to verify identity tokens)
	r.Group(func(r chi.Router) {
		r.Use(publicCORS)
		r.Get("/.well-known/jwks.json", identityHandler.JWKS)
	})

	// ACME HTTP-01 challenge handler (autocert handles this via the main HTTP server)
	// autocert.Manager provides an HTTP handler for /.well-known/acme-challenge/

	// OAuth routes (use auth CORS)
	r.Group(func(r chi.Router) {
		r.Use(authCORS)

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
	})

	writeNotFound := func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"not found"}`))
	}

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

		// Get agent name and UUID from query params
		agentName := r.URL.Query().Get("name")
		if agentName == "" {
			agentName = "relay-agent"
		}
		agentUUID := r.URL.Query().Get("uuid")

		relayHub.HandleAgentWS(w, r, token.UserID, agentName, agentUUID)
	})

	// Public page endpoints — E2E encrypted, no auth required.
	// Own subrouter so CORS middleware handles OPTIONS correctly.
	r.Route("/api/public-page", func(r chi.Router) {
		r.Use(publicCORS)

		// GET: discovery — returns agent UUID + X25519 pubkey (no content, no relay)
		r.Get("/{username}/{slug}", func(w http.ResponseWriter, r *http.Request) {
			username := chi.URLParam(r, "username")
			slug := chi.URLParam(r, "slug")
			if !validSlugRe.MatchString(slug) {
				writeNotFound(w)
				return
			}

			user, err := db.GetUserByUsername(r.Context(), username)
			if err != nil {
				writeNotFound(w)
				return
			}

			agents, err := db.ListAgents(r.Context(), user.ID)
			if err != nil || len(agents) == 0 {
				writeNotFound(w)
				return
			}

			// Find first online agent with X25519 pubkey
			for _, agent := range agents {
				if !relayHub.IsOnline(agent.ID) {
					continue
				}
				if agent.X25519PubKey == nil {
					continue
				}
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "public, s-maxage=300")
				json.NewEncoder(w).Encode(map[string]interface{}{
					"agent_uuid":    agent.ID,
					"x25519_public": base64.StdEncoding.EncodeToString(agent.X25519PubKey),
				})
				return
			}
			writeNotFound(w)
		})

		// POST: blind encrypted relay by agent UUID
		r.Post("/{agent_uuid}/{slug}", func(w http.ResponseWriter, r *http.Request) {
			agentUUID := chi.URLParam(r, "agent_uuid")
			slug := chi.URLParam(r, "slug")
			if !validSlugRe.MatchString(slug) {
				writeNotFound(w)
				return
			}

			var body struct {
				ID        string `json:"id"`
				Encrypted bool   `json:"encrypted"`
				KeyID     string `json:"key_id"`
				Payload   string `json:"payload"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeNotFound(w)
				return
			}
			if !body.Encrypted || body.KeyID == "" || body.Payload == "" {
				writeNotFound(w)
				return
			}

			agent, err := db.GetAgentByUUID(r.Context(), agentUUID)
			if err != nil || !relayHub.IsOnline(agent.ID) {
				writeNotFound(w)
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			defer cancel()

			reqID, _ := auth.GenerateRandomHex(16)
			resp, err := relayHub.SendRequest(ctx, agent.ID, wire.RelayRequest{
				ID: reqID, Encrypted: true, KeyID: body.KeyID, Payload: body.Payload,
			})
			if err != nil {
				writeNotFound(w)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)

			viewRecorder.Record(analytics.PageView{
				UserID:    agent.UserID,
				Slug:      slug,
				IP:        r.RemoteAddr,
				Referrer:  r.Header.Get("X-Referrer"),
				UserAgent: r.UserAgent(),
			})
		})
	})

	// Authenticated API routes (restrictive CORS)
	r.Route("/api", func(r chi.Router) {
		r.Use(authCORS)
		r.Use(middleware.RequireAuth(db))

			// Identity token for shared page access (Ed25519-signed, 5-min expiry)
			r.Get("/identity-token", identityHandler.GetToken)

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
					req.ExpiresIn = 3650
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

			// Page analytics
			r.Get("/page-analytics", func(w http.ResponseWriter, r *http.Request) {
				userID := middleware.GetUserID(r)
				stats, err := db.GetPageAnalytics(r.Context(), userID)
				if err != nil {
					http.Error(w, `{"error":"failed to get analytics"}`, http.StatusInternalServerError)
					return
				}
				if stats == nil {
					stats = []models.PageAnalytics{}
				}
				// Attach top referrers for each page (max 5)
				for i := range stats {
					refs, err := db.GetTopReferrers(r.Context(), userID, stats[i].Slug, 5)
					if err == nil {
						stats[i].TopReferrers = refs
					}
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(stats)
			})

			// Per-page detailed analytics (for modal)
			r.Get("/page-analytics/{slug}", func(w http.ResponseWriter, r *http.Request) {
				userID := middleware.GetUserID(r)
				slug := chi.URLParam(r, "slug")

				stats, err := db.GetPageAnalytics(r.Context(), userID)
				if err != nil {
					http.Error(w, `{"error":"failed to get analytics"}`, http.StatusInternalServerError)
					return
				}
				// Find the specific page
				var pageStats *models.PageAnalytics
				for i := range stats {
					if stats[i].Slug == slug {
						pageStats = &stats[i]
						break
					}
				}

				result := models.PageDetailedAnalytics{
					Slug:         slug,
					DailyViews:   []models.DailyView{},
					TopReferrers: []models.Referrer{},
				}
				if pageStats != nil {
					result.TotalViews = pageStats.TotalViews
					result.UniqueVisitors = pageStats.UniqueVisitors
					result.LastViewedAt = pageStats.LastViewedAt
				}

				// Daily views (last 30 days)
				daily, err := db.GetPageDailyViews(r.Context(), userID, slug, 30)
				if err == nil && daily != nil {
					result.DailyViews = daily
				}

				// Top referrers (top 10)
				refs, err := db.GetTopReferrers(r.Context(), userID, slug, 10)
				if err == nil && refs != nil {
					result.TopReferrers = refs
				}

				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(result)
			})

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

			// Custom Domains
			r.Route("/custom-domains", func(r chi.Router) {
				r.Post("/", customDomainsHandler.Create)
				r.Get("/", customDomainsHandler.List)
				r.Post("/{id}/verify", customDomainsHandler.Verify)
				r.Put("/{id}", customDomainsHandler.Update)
				r.Delete("/{id}", customDomainsHandler.Delete)
			})
	})

	// Logout outside /api Route (no auth required, uses auth CORS)
	r.Group(func(r chi.Router) {
		r.Use(authCORS)
		r.Post("/api/logout", func(w http.ResponseWriter, r *http.Request) {
			http.SetCookie(w, sessionCookie("", -1))
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok"}`))
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
		viewRecorder.Shutdown()
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

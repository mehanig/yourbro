package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
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
	"github.com/mehanig/yourbro/api/internal/auth"
	"github.com/mehanig/yourbro/api/internal/handlers"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/storage"
)

//go:embed static/*
var staticFiles embed.FS

//go:embed migrations/*.sql
var migrationFiles embed.FS

func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
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
		data, err := migrationFiles.ReadFile(filepath.Join("migrations", entry.Name()))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		log.Printf("Running migration: %s", entry.Name())
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			return fmt.Errorf("execute migration %s: %w", entry.Name(), err)
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

	// Load SDK script for inline injection into page content
	sdkScript := ""
	if sdkData, err := staticFiles.ReadFile("static/sdk/clawd-storage.js"); err == nil {
		sdkScript = string(sdkData)
		log.Printf("Loaded SDK script (%d bytes)", len(sdkScript))
	} else {
		log.Printf("WARNING: SDK script not found in static/sdk/clawd-storage.js: %v", err)
	}

	oauthCfg := auth.NewGoogleOAuthConfig()
	pagesHandler := &handlers.PagesHandler{
		DB:        db,
		AllowHTTP: os.Getenv("ALLOW_HTTP_AGENT") == "true",
		SDKScript: sdkScript,
	}
	keysHandler := &handlers.KeysHandler{DB: db}
	sseBroker := handlers.NewSSEBroker(db)
	sseBroker.StartStaleChecker(context.Background())
	agentsHandler := &handlers.AgentsHandler{DB: db, Broker: sseBroker}

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RealIP)
	frontendURL := getEnv("FRONTEND_URL", "http://localhost:5173")
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{frontendURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// OAuth routes
	r.Get("/auth/google", func(w http.ResponseWriter, r *http.Request) {
		state := r.URL.Query().Get("state")
		if state == "" {
			state = "login"
		}
		url := oauthCfg.AuthCodeURL(state)
		http.Redirect(w, r, url, http.StatusTemporaryRedirect)
	})

	r.Get("/auth/google/callback", func(w http.ResponseWriter, r *http.Request) {
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

		http.Redirect(w, r, frontendURL+"/#/callback?token="+token, http.StatusTemporaryRedirect)
	})

	// Public page rendering
	r.Get("/p/{username}/{slug}", pagesHandler.RenderPage)
	r.Get("/api/pages/{id}/content", pagesHandler.RenderPageContent)

	// Authenticated API routes
	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.RequireAuth(db))

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

		// Pages
		r.Route("/pages", func(r chi.Router) {
			r.With(middleware.RequireScope("publish:pages")).Post("/", pagesHandler.Create)
			r.With(middleware.RequireScope("read:pages")).Get("/", pagesHandler.List)
			r.With(middleware.RequireScope("read:pages")).Get("/{id}", pagesHandler.Get)
			r.With(middleware.RequireScope("read:pages")).Get("/{id}/content-meta", pagesHandler.ContentMeta)
			r.Delete("/{id}", pagesHandler.Delete)
		})

		// Agents
		r.Route("/agents", func(r chi.Router) {
			r.Post("/", agentsHandler.Register)
			r.Get("/", agentsHandler.List)
			r.Delete("/{id}", agentsHandler.Delete)
			r.Post("/heartbeat", agentsHandler.Heartbeat)
			r.Get("/stream", sseBroker.ServeHTTP)
		})

		// Public Keys
		r.Route("/keys", func(r chi.Router) {
			r.With(middleware.RequireScope("manage:keys")).Post("/", keysHandler.Create)
			r.Get("/", keysHandler.List)
			r.With(middleware.RequireScope("manage:keys")).Delete("/{id}", keysHandler.Delete)
		})
	})

	// Embedded frontend: serve static files with SPA fallback
	staticSub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatalf("Failed to create static sub filesystem: %v", err)
	}
	fileServer := http.FileServer(http.FS(staticSub))
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		// Try serving the actual file first
		path := strings.TrimPrefix(req.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if f, err := staticSub.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, req)
			return
		}
		// SPA fallback: serve index.html for client-side routing
		req.URL.Path = "/"
		fileServer.ServeHTTP(w, req)
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


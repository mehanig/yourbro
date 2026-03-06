package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"net/http"
	"math/big"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/mehanig/yourbro/agent/internal/e2e"
	"github.com/mehanig/yourbro/agent/internal/handlers"
	mw "github.com/mehanig/yourbro/agent/internal/middleware"
	"github.com/mehanig/yourbro/agent/internal/relay"
	"github.com/mehanig/yourbro/agent/internal/storage"
)

func main() {
	sqlitePath := getEnv("SQLITE_PATH", "/data/agent.db")

	db, err := storage.NewDB(sqlitePath)
	if err != nil {
		log.Fatalf("Failed to open SQLite: %v", err)
	}
	defer db.Close()

	// Ensure pages directory exists
	const pagesDir = "/data/yourbro/pages"
	if err := os.MkdirAll(pagesDir, 0755); err != nil {
		log.Fatalf("Failed to create pages directory: %v", err)
	}

	// Generate pairing code on startup (8 chars, alphanumeric, 5-min expiry)
	pairingCode := generatePairingCode(8)
	pairingExpiry := time.Now().Add(5 * time.Minute)

	log.Printf("=== PAIRING CODE: %s (expires in 5 minutes) ===", pairingCode)

	storageHandler := &handlers.StorageHandler{DB: db}
	pagesHandler := &handlers.PagesHandler{PagesDir: pagesDir}
	pairHandler := &handlers.PairHandler{
		DB:            db,
		PairingCode:   pairingCode,
		PairingExpiry: pairingExpiry,
	}

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(mw.CORSForYourbro()))

	// Health check (no auth)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Pairing endpoint (no auth — pairing code IS the auth)
	r.Post("/api/pair", pairHandler.Pair)

	// Auth check — browser probes this to detect pairing status
	r.Route("/api/auth-check", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			username := mw.GetUsername(r)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"paired","username":"` + username + `"}`))
		})
	})

	// Key revocation (require user signature — RFC 9421)
	r.Route("/api/keys", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Delete("/", pairHandler.RevokeKey)
	})

	// Page routes — read-only via relay. Pages are created by ClawdBot internally.
	r.Get("/api/pages", pagesHandler.List)
	r.Get("/api/page/{slug}", pagesHandler.Get)

	// Storage routes (require user signature — RFC 9421)
	r.Route("/api/storage/{slug}", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Get("/", storageHandler.List)
		r.Get("/{key}", storageHandler.Get)
		r.Put("/{key}", storageHandler.Set)
		r.Delete("/{key}", storageHandler.Delete)
	})

	// Relay mode — connect to server via WebSocket
	apiToken := os.Getenv("YOURBRO_TOKEN")
	serverURL := os.Getenv("YOURBRO_SERVER_URL")
	agentName := getEnv("YOURBRO_AGENT_NAME", "relay-agent")

	if apiToken == "" || serverURL == "" {
		log.Fatalf("YOURBRO_TOKEN and YOURBRO_SERVER_URL are required")
	}

	serverURL = strings.TrimRight(serverURL, "/")
	log.Printf("Connecting to %s via WebSocket", serverURL)

	// Initialize E2E encryption if agent has an identity
	var cipherCache *e2e.CipherCache
	if identity, err := db.GetOrCreateIdentity(); err != nil {
		log.Printf("WARNING: E2E encryption disabled: %v", err)
	} else {
		cipherCache = e2e.NewCipherCache(identity.X25519PrivateKey)
		log.Printf("E2E encryption enabled (X25519 pub: %x...)", identity.X25519PublicKey.Bytes()[:8])
	}

	// Auto-regenerate pairing code every 5 minutes
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			code := pairHandler.Regenerate(generatePairingCode)
			if !pairHandler.IsPaired() {
				log.Printf("=== PAIRING CODE: %s (expires in 5 minutes) ===", code)
			}
		}
	}()

	router := &relay.Router{Mux: r, CipherCache: cipherCache, DB: db}
	client := &relay.Client{
		ServerURL: serverURL,
		APIToken:  apiToken,
		AgentName: agentName,
		Handler:   router.HandleRequest,
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		cancel()
	}()

	client.Run(ctx)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

const pairingChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

func generatePairingCode(length int) string {
	code := make([]byte, length)
	for i := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(pairingChars))))
		if err != nil {
			panic(fmt.Sprintf("crypto/rand failed: %v", err))
		}
		code[i] = pairingChars[n.Int64()]
	}
	return string(code)
}

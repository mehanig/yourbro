package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/mehanig/yourbro/agent/internal/handlers"
	mw "github.com/mehanig/yourbro/agent/internal/middleware"
	"github.com/mehanig/yourbro/agent/internal/storage"
	"golang.org/x/crypto/acme/autocert"
)

func main() {
	domain := os.Getenv("AGENT_DOMAIN")
	port := getEnv("AGENT_PORT", "8443")
	sqlitePath := getEnv("SQLITE_PATH", "/data/agent.db")

	db, err := storage.NewDB(sqlitePath)
	if err != nil {
		log.Fatalf("Failed to open SQLite: %v", err)
	}
	defer db.Close()

	// Generate pairing code on startup (8 chars, alphanumeric, 5-min expiry)
	pairingCode := generatePairingCode(8)
	pairingExpiry := time.Now().Add(5 * time.Minute)

	log.Printf("=== PAIRING CODE: %s (expires in 5 minutes) ===", pairingCode)

	storageHandler := &handlers.StorageHandler{DB: db}
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

	// Key revocation (require user signature — RFC 9421)
	r.Route("/api/keys", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Delete("/", pairHandler.RevokeKey)
	})

	// Storage routes (require user signature — RFC 9421)
	r.Route("/api/storage/{slug}", func(r chi.Router) {
		r.Use(mw.VerifyUserSignature(db))
		r.Get("/", storageHandler.List)
		r.Get("/{key}", storageHandler.Get)
		r.Put("/{key}", storageHandler.Set)
		r.Delete("/{key}", storageHandler.Delete)
	})

	// Start heartbeat if API token and server URL are configured
	apiToken := os.Getenv("YB_API_TOKEN")
	serverURL := os.Getenv("YB_SERVER_URL")
	agentEndpoint := os.Getenv("YB_AGENT_ENDPOINT") // how the server knows this agent
	if apiToken != "" && serverURL != "" && agentEndpoint != "" {
		startHeartbeat(serverURL, apiToken, agentEndpoint)
		log.Printf("Heartbeat started → %s (every 60s)", serverURL)
	} else if apiToken != "" || serverURL != "" {
		log.Printf("WARNING: Set YB_API_TOKEN, YB_SERVER_URL, and YB_AGENT_ENDPOINT to enable heartbeat")
	}

	if domain != "" {
		// Production: autocert TLS
		m := &autocert.Manager{
			Cache:      autocert.DirCache("/data/certs"),
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(domain),
		}

		go func() {
			log.Println("Starting ACME HTTP challenge server on :80")
			if err := http.ListenAndServe(":80", m.HTTPHandler(nil)); err != nil {
				log.Fatalf("ACME HTTP server error: %v", err)
			}
		}()

		srv := &http.Server{
			Addr:      ":" + port,
			Handler:   r,
			TLSConfig: m.TLSConfig(),
		}

		go func() {
			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
			<-sigCh
			log.Println("Shutting down...")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			srv.Shutdown(ctx)
		}()

		log.Printf("Agent server starting on :%s (TLS, domain=%s)", port, domain)
		if err := srv.ListenAndServeTLS("", ""); err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	} else {
		// Development: plain HTTP
		srv := &http.Server{
			Addr:    ":" + port,
			Handler: r,
		}

		go func() {
			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
			<-sigCh
			log.Println("Shutting down...")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			srv.Shutdown(ctx)
		}()

		log.Printf("Agent server starting on :%s (no TLS, dev mode)", port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func startHeartbeat(serverURL, apiToken, endpoint string) {
	serverURL = strings.TrimRight(serverURL, "/")
	send := func() {
		body := strings.NewReader(fmt.Sprintf(`{"endpoint":%q}`, endpoint))
		req, err := http.NewRequest("POST", serverURL+"/api/agents/heartbeat", body)
		if err != nil {
			return
		}
		req.Header.Set("Authorization", "Bearer "+apiToken)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			log.Printf("Heartbeat failed: %v", err)
			return
		}
		resp.Body.Close()
	}
	send() // immediate first heartbeat
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			send()
		}
	}()
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

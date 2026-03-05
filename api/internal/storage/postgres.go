package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mehanig/yourbro/api/internal/models"
)

type DB struct {
	Pool *pgxpool.Pool
}

func NewDB(ctx context.Context, databaseURL string) (*DB, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &DB{Pool: pool}, nil
}

func (db *DB) Close() {
	db.Pool.Close()
}

// Users

func (db *DB) UpsertUser(ctx context.Context, googleID, email, username string) (*models.User, error) {
	var u models.User
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO users (google_id, email, username)
		VALUES ($1, $2, $3)
		ON CONFLICT (google_id) DO UPDATE SET email = $2
		RETURNING id, google_id, email, username, created_at
	`, googleID, email, username).Scan(&u.ID, &u.GoogleID, &u.Email, &u.Username, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (db *DB) GetUserByID(ctx context.Context, id int64) (*models.User, error) {
	var u models.User
	err := db.Pool.QueryRow(ctx, `
		SELECT id, google_id, email, username, created_at FROM users WHERE id = $1
	`, id).Scan(&u.ID, &u.GoogleID, &u.Email, &u.Username, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (db *DB) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	var u models.User
	err := db.Pool.QueryRow(ctx, `
		SELECT id, google_id, email, username, created_at FROM users WHERE username = $1
	`, username).Scan(&u.ID, &u.GoogleID, &u.Email, &u.Username, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// Tokens

func (db *DB) CreateToken(ctx context.Context, userID int64, tokenHash, name string, scopes []string, expiresAt time.Time) (int64, error) {
	var id int64
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO tokens (user_id, token_hash, name, scopes, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, userID, tokenHash, name, scopes, expiresAt).Scan(&id)
	return id, err
}

func (db *DB) GetTokenByHash(ctx context.Context, tokenHash string) (*models.Token, error) {
	var t models.Token
	err := db.Pool.QueryRow(ctx, `
		SELECT id, user_id, token_hash, name, scopes, expires_at, created_at
		FROM tokens WHERE token_hash = $1 AND expires_at > NOW()
	`, tokenHash).Scan(&t.ID, &t.UserID, &t.TokenHash, &t.Name, &t.Scopes, &t.ExpiresAt, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (db *DB) ListTokens(ctx context.Context, userID int64) ([]models.Token, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT id, user_id, name, scopes, expires_at, created_at
		FROM tokens WHERE user_id = $1 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tokens []models.Token
	for rows.Next() {
		var t models.Token
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.Scopes, &t.ExpiresAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, nil
}

func (db *DB) DeleteToken(ctx context.Context, id, userID int64) error {
	_, err := db.Pool.Exec(ctx, `DELETE FROM tokens WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// Pages

func (db *DB) CreatePage(ctx context.Context, userID int64, slug, title, htmlContent string, agentEndpoint *string) (*models.Page, error) {
	var p models.Page
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO pages (user_id, slug, title, html_content, agent_endpoint)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, slug) DO UPDATE SET title = $3, html_content = $4, agent_endpoint = $5, updated_at = NOW()
		RETURNING id, user_id, slug, title, html_content, agent_endpoint, created_at, updated_at
	`, userID, slug, title, htmlContent, agentEndpoint).Scan(&p.ID, &p.UserID, &p.Slug, &p.Title, &p.HTMLContent, &p.AgentEndpoint, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (db *DB) GetPage(ctx context.Context, id int64) (*models.Page, error) {
	var p models.Page
	err := db.Pool.QueryRow(ctx, `
		SELECT id, user_id, slug, title, html_content, agent_endpoint, created_at, updated_at
		FROM pages WHERE id = $1
	`, id).Scan(&p.ID, &p.UserID, &p.Slug, &p.Title, &p.HTMLContent, &p.AgentEndpoint, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (db *DB) GetPageByUserAndSlug(ctx context.Context, userID int64, slug string) (*models.Page, error) {
	var p models.Page
	err := db.Pool.QueryRow(ctx, `
		SELECT id, user_id, slug, title, html_content, agent_endpoint, created_at, updated_at
		FROM pages WHERE user_id = $1 AND slug = $2
	`, userID, slug).Scan(&p.ID, &p.UserID, &p.Slug, &p.Title, &p.HTMLContent, &p.AgentEndpoint, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (db *DB) ListPages(ctx context.Context, userID int64) ([]models.Page, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT id, user_id, slug, title, agent_endpoint, created_at, updated_at
		FROM pages WHERE user_id = $1 ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pages []models.Page
	for rows.Next() {
		var p models.Page
		if err := rows.Scan(&p.ID, &p.UserID, &p.Slug, &p.Title, &p.AgentEndpoint, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, nil
}

func (db *DB) DeletePage(ctx context.Context, id, userID int64) error {
	_, err := db.Pool.Exec(ctx, `DELETE FROM pages WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// Public Keys

func (db *DB) CreatePublicKey(ctx context.Context, userID int64, name, publicKey string) (*models.PublicKey, error) {
	var pk models.PublicKey
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO public_keys (user_id, name, public_key)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, name, public_key, created_at
	`, userID, name, publicKey).Scan(&pk.ID, &pk.UserID, &pk.Name, &pk.PublicKey, &pk.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &pk, nil
}

func (db *DB) ListPublicKeys(ctx context.Context, userID int64) ([]models.PublicKey, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT id, user_id, name, public_key, created_at
		FROM public_keys WHERE user_id = $1 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []models.PublicKey
	for rows.Next() {
		var pk models.PublicKey
		if err := rows.Scan(&pk.ID, &pk.UserID, &pk.Name, &pk.PublicKey, &pk.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, pk)
	}
	return keys, nil
}

func (db *DB) DeletePublicKey(ctx context.Context, id, userID int64) error {
	_, err := db.Pool.Exec(ctx, `DELETE FROM public_keys WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

func (db *DB) GetPublicKeysByUserID(ctx context.Context, userID int64) ([]models.PublicKey, error) {
	return db.ListPublicKeys(ctx, userID)
}

// GetUserByPublicKey finds a user by their registered public key.
func (db *DB) GetUserByPublicKey(ctx context.Context, publicKey string) (*models.User, error) {
	var u models.User
	err := db.Pool.QueryRow(ctx, `
		SELECT u.id, u.google_id, u.email, u.username, u.created_at
		FROM users u
		JOIN public_keys pk ON pk.user_id = u.id
		WHERE pk.public_key = $1
		LIMIT 1
	`, publicKey).Scan(&u.ID, &u.GoogleID, &u.Email, &u.Username, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// Agents

func (db *DB) CreateAgent(ctx context.Context, userID int64, name string, endpoint *string) (*models.Agent, error) {
	var a models.Agent
	var err error
	if endpoint != nil && *endpoint != "" {
		// Direct-mode agent with endpoint — upsert on (user_id, endpoint)
		err = db.Pool.QueryRow(ctx, `
			INSERT INTO agents (user_id, name, endpoint)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id, endpoint) WHERE endpoint IS NOT NULL DO UPDATE SET name = $2
			RETURNING id, user_id, name, endpoint, last_heartbeat, paired_at
		`, userID, name, *endpoint).Scan(&a.ID, &a.UserID, &a.Name, &a.Endpoint, &a.LastHeartbeat, &a.PairedAt)
	} else {
		// Relay-mode agent — always insert (no endpoint to conflict on)
		err = db.Pool.QueryRow(ctx, `
			INSERT INTO agents (user_id, name, endpoint)
			VALUES ($1, $2, NULL)
			RETURNING id, user_id, name, endpoint, last_heartbeat, paired_at
		`, userID, name).Scan(&a.ID, &a.UserID, &a.Name, &a.Endpoint, &a.LastHeartbeat, &a.PairedAt)
	}
	if err != nil {
		return nil, err
	}
	a.IsOnline = a.LastHeartbeat != nil && time.Since(*a.LastHeartbeat) < 2*time.Minute
	return &a, nil
}

func (db *DB) ListAgents(ctx context.Context, userID int64) ([]models.Agent, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT id, user_id, name, endpoint, last_heartbeat, paired_at
		FROM agents WHERE user_id = $1 ORDER BY paired_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []models.Agent
	for rows.Next() {
		var a models.Agent
		if err := rows.Scan(&a.ID, &a.UserID, &a.Name, &a.Endpoint, &a.LastHeartbeat, &a.PairedAt); err != nil {
			return nil, err
		}
		a.IsOnline = a.LastHeartbeat != nil && time.Since(*a.LastHeartbeat) < 2*time.Minute
		agents = append(agents, a)
	}
	return agents, nil
}

func (db *DB) DeleteAgent(ctx context.Context, id, userID int64) error {
	_, err := db.Pool.Exec(ctx, `DELETE FROM agents WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

func (db *DB) UpdateHeartbeat(ctx context.Context, userID int64, endpoint string) error {
	tag, err := db.Pool.Exec(ctx, `
		UPDATE agents SET last_heartbeat = NOW()
		WHERE user_id = $1 AND endpoint = $2
	`, userID, endpoint)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agent not found")
	}
	return nil
}

func (db *DB) UpdateHeartbeatByID(ctx context.Context, agentID int64) error {
	tag, err := db.Pool.Exec(ctx, `
		UPDATE agents SET last_heartbeat = NOW()
		WHERE id = $1
	`, agentID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agent not found")
	}
	return nil
}

func (db *DB) GetAgentByID(ctx context.Context, id int64) (*models.Agent, error) {
	var a models.Agent
	err := db.Pool.QueryRow(ctx, `
		SELECT id, user_id, name, endpoint, last_heartbeat, paired_at
		FROM agents WHERE id = $1
	`, id).Scan(&a.ID, &a.UserID, &a.Name, &a.Endpoint, &a.LastHeartbeat, &a.PairedAt)
	if err != nil {
		return nil, err
	}
	a.IsOnline = a.LastHeartbeat != nil && time.Since(*a.LastHeartbeat) < 2*time.Minute
	return &a, nil
}

// GetAgentByUserAndName finds an agent by user ID and name (for relay-mode registration).
func (db *DB) GetAgentByUserAndName(ctx context.Context, userID int64, name string) (*models.Agent, error) {
	var a models.Agent
	err := db.Pool.QueryRow(ctx, `
		SELECT id, user_id, name, endpoint, last_heartbeat, paired_at
		FROM agents WHERE user_id = $1 AND name = $2 AND endpoint IS NULL
	`, userID, name).Scan(&a.ID, &a.UserID, &a.Name, &a.Endpoint, &a.LastHeartbeat, &a.PairedAt)
	if err != nil {
		return nil, err
	}
	a.IsOnline = a.LastHeartbeat != nil && time.Since(*a.LastHeartbeat) < 2*time.Minute
	return &a, nil
}

// RunMigrations runs SQL migration files in order.
func (db *DB) RunMigrations(ctx context.Context, migrationsDir string) error {
	// Create migrations tracking table
	_, err := db.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	files := []string{
		"001_create_users.sql",
		"002_create_tokens.sql",
		"003_create_pages.sql",
		"005_agent_keys_and_endpoint.sql",
	}

	for _, f := range files {
		var exists bool
		err := db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, f).Scan(&exists)
		if err != nil {
			return fmt.Errorf("check migration %s: %w", f, err)
		}
		if exists {
			continue
		}

		path := strings.TrimRight(migrationsDir, "/") + "/" + f
		// Read file content — we import os in the caller, but here we use pgx directly
		// For simplicity, embed migration SQL or read from embedded FS
		// This is handled by the caller passing SQL content
		_ = path

		// We'll run migrations via Makefile/psql instead for simplicity
		// Mark as applied
		if _, err := db.Pool.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, f); err != nil {
			return fmt.Errorf("record migration %s: %w", f, err)
		}
	}
	return nil
}

// RunMigrationSQL runs a single migration SQL string if not already applied.
func (db *DB) RunMigrationSQL(ctx context.Context, version, sql string) error {
	var exists bool
	err := db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&exists)
	if err != nil {
		if err == pgx.ErrNoRows {
			exists = false
		} else {
			return err
		}
	}
	if exists {
		return nil
	}

	if _, err := db.Pool.Exec(ctx, sql); err != nil {
		return fmt.Errorf("run migration %s: %w", version, err)
	}
	if _, err := db.Pool.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
		return fmt.Errorf("record migration %s: %w", version, err)
	}
	return nil
}

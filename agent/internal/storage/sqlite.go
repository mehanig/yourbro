package storage

import (
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type DB struct {
	db *sql.DB

	// In-memory cache of authorized keys for zero-overhead auth on the hot path.
	authKeysMu sync.RWMutex
	authKeys   map[string]string // public_key -> username
}

func NewDB(path string) (*DB, error) {
	db, err := sql.Open("sqlite3", path+"?_journal=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Create schema
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS storage (
			page_slug TEXT NOT NULL,
			key TEXT NOT NULL,
			value_json TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (page_slug, key)
		);
		CREATE TABLE IF NOT EXISTS authorized_keys (
			public_key TEXT NOT NULL PRIMARY KEY,
			username TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		return nil, fmt.Errorf("create schema: %w", err)
	}

	d := &DB{db: db, authKeys: make(map[string]string)}
	if err := d.reloadAuthKeys(); err != nil {
		return nil, fmt.Errorf("load authorized keys: %w", err)
	}
	return d, nil
}

func (d *DB) Close() error {
	return d.db.Close()
}

// --- Authorized Keys ---

func (d *DB) AddAuthorizedKey(publicKey, username string) error {
	_, err := d.db.Exec(
		`INSERT OR REPLACE INTO authorized_keys (public_key, username, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
		publicKey, username,
	)
	if err != nil {
		return err
	}
	// Reload cache
	return d.reloadAuthKeys()
}

// IsKeyAuthorized checks the in-memory cache. Returns (username, true) if authorized.
func (d *DB) IsKeyAuthorized(publicKey string) (string, bool) {
	d.authKeysMu.RLock()
	defer d.authKeysMu.RUnlock()
	username, ok := d.authKeys[publicKey]
	return username, ok
}

func (d *DB) reloadAuthKeys() error {
	rows, err := d.db.Query(`SELECT public_key, username FROM authorized_keys`)
	if err != nil {
		return err
	}
	defer rows.Close()

	keys := make(map[string]string)
	for rows.Next() {
		var pk, user string
		if err := rows.Scan(&pk, &user); err != nil {
			return err
		}
		keys[pk] = user
	}

	d.authKeysMu.Lock()
	d.authKeys = keys
	d.authKeysMu.Unlock()
	return nil
}

// --- Storage ---

type Entry struct {
	PageSlug  string    `json:"page_slug"`
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (d *DB) Get(slug, key string) (*Entry, error) {
	var e Entry
	err := d.db.QueryRow(
		`SELECT page_slug, key, value_json, updated_at FROM storage WHERE page_slug = ? AND key = ?`,
		slug, key,
	).Scan(&e.PageSlug, &e.Key, &e.Value, &e.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (d *DB) Set(slug, key, valueJSON string) error {
	_, err := d.db.Exec(`
		INSERT INTO storage (page_slug, key, value_json, updated_at)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT (page_slug, key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
	`, slug, key, valueJSON)
	return err
}

func (d *DB) Delete(slug, key string) error {
	_, err := d.db.Exec(`DELETE FROM storage WHERE page_slug = ? AND key = ?`, slug, key)
	return err
}

func (d *DB) List(slug, prefix string) ([]Entry, error) {
	query := `SELECT page_slug, key, value_json, updated_at FROM storage WHERE page_slug = ?`
	args := []any{slug}

	if prefix != "" {
		// Escape LIKE wildcards to prevent injection
		escaped := strings.NewReplacer("%", `\%`, "_", `\_`).Replace(prefix)
		query += ` AND key LIKE ? ESCAPE '\'`
		args = append(args, escaped+"%")
	}
	query += ` ORDER BY key`

	rows, err := d.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.PageSlug, &e.Key, &e.Value, &e.UpdatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}

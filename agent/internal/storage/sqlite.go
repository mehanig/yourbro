package storage

import (
	"crypto/ecdh"
	"crypto/rand"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Identity holds the agent's X25519 keypair for E2E encryption.
type Identity struct {
	X25519PrivateKey *ecdh.PrivateKey
	X25519PublicKey  *ecdh.PublicKey
}

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
			x25519_public_key BLOB,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS agent_identity (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			x25519_private_key BLOB NOT NULL,
			x25519_public_key BLOB NOT NULL
		);
	`)
	if err != nil {
		return nil, fmt.Errorf("create schema: %w", err)
	}

	// Migrations: add columns/tables that may not exist in older databases
	db.Exec(`ALTER TABLE authorized_keys ADD COLUMN x25519_public_key BLOB`) // ignore error if already exists
	// Drop legacy pages table — pages are now directory-based on the filesystem
	db.Exec(`DROP TABLE IF EXISTS pages`)

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

func (d *DB) DeleteAuthorizedKey(publicKey string) error {
	_, err := d.db.Exec(`DELETE FROM authorized_keys WHERE public_key = ?`, publicKey)
	if err != nil {
		return err
	}
	return d.reloadAuthKeys()
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

// --- Agent Identity (X25519) ---

// GetOrCreateIdentity returns the agent's X25519 keypair, generating one on first call.
func (d *DB) GetOrCreateIdentity() (*Identity, error) {
	var privBytes, pubBytes []byte
	err := d.db.QueryRow(`SELECT x25519_private_key, x25519_public_key FROM agent_identity WHERE id = 1`).
		Scan(&privBytes, &pubBytes)
	if err == nil {
		priv, err := ecdh.X25519().NewPrivateKey(privBytes)
		if err != nil {
			return nil, fmt.Errorf("parse stored X25519 private key: %w", err)
		}
		return &Identity{
			X25519PrivateKey: priv,
			X25519PublicKey:  priv.PublicKey(),
		}, nil
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("query agent_identity: %w", err)
	}

	// Generate new X25519 keypair
	priv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate X25519 keypair: %w", err)
	}

	_, err = d.db.Exec(
		`INSERT INTO agent_identity (id, x25519_private_key, x25519_public_key) VALUES (1, ?, ?)`,
		priv.Bytes(), priv.PublicKey().Bytes(),
	)
	if err != nil {
		return nil, fmt.Errorf("store X25519 keypair: %w", err)
	}

	return &Identity{
		X25519PrivateKey: priv,
		X25519PublicKey:  priv.PublicKey(),
	}, nil
}

// StoreUserX25519Key stores a user's X25519 public key alongside their Ed25519 key.
func (d *DB) StoreUserX25519Key(ed25519PubKey string, x25519PubKeyBytes []byte) error {
	_, err := d.db.Exec(
		`UPDATE authorized_keys SET x25519_public_key = ? WHERE public_key = ?`,
		x25519PubKeyBytes, ed25519PubKey,
	)
	return err
}

// ListAuthorizedKeysWithX25519 returns X25519 public keys for all authorized users that have one.
func (d *DB) ListAuthorizedKeysWithX25519() []*ecdh.PublicKey {
	rows, err := d.db.Query(`SELECT x25519_public_key FROM authorized_keys WHERE x25519_public_key IS NOT NULL`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var keys []*ecdh.PublicKey
	for rows.Next() {
		var keyBytes []byte
		if err := rows.Scan(&keyBytes); err != nil {
			continue
		}
		pub, err := ecdh.X25519().NewPublicKey(keyBytes)
		if err != nil {
			continue
		}
		keys = append(keys, pub)
	}
	return keys
}

// GetUserX25519Key retrieves a user's X25519 public key by their Ed25519 public key.
func (d *DB) GetUserX25519Key(ed25519PubKey string) (*ecdh.PublicKey, error) {
	var keyBytes []byte
	err := d.db.QueryRow(
		`SELECT x25519_public_key FROM authorized_keys WHERE public_key = ?`,
		ed25519PubKey,
	).Scan(&keyBytes)
	if err != nil {
		return nil, err
	}
	if keyBytes == nil {
		return nil, sql.ErrNoRows
	}
	return ecdh.X25519().NewPublicKey(keyBytes)
}

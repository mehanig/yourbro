package storage

import (
	"crypto/ecdh"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"log"
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

	// In-memory cache of authorized X25519 keys: base64url(x25519_pub) -> username
	authKeysMu sync.RWMutex
	authKeys   map[string]string
}

func NewDB(path string) (*DB, error) {
	db, err := sql.Open("sqlite3", path+"?_journal=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Detect old schema (has public_key TEXT column in authorized_keys) and migrate
	if needsMigration(db) {
		log.Println("Migrating authorized_keys table from Ed25519 to X25519-only schema. Please re-pair your browser.")
		db.Exec(`DROP TABLE IF EXISTS authorized_keys`)
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
			x25519_public_key BLOB NOT NULL PRIMARY KEY,
			username TEXT NOT NULL,
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

	// Drop legacy pages table — pages are now directory-based on the filesystem
	db.Exec(`DROP TABLE IF EXISTS pages`)

	d := &DB{db: db, authKeys: make(map[string]string)}
	if err := d.reloadAuthKeys(); err != nil {
		return nil, fmt.Errorf("load authorized keys: %w", err)
	}
	return d, nil
}

// needsMigration checks if the old Ed25519-based schema exists.
func needsMigration(db *sql.DB) bool {
	rows, err := db.Query(`PRAGMA table_info(authorized_keys)`)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			continue
		}
		if name == "public_key" {
			return true // old Ed25519 schema detected
		}
	}
	return false
}

func (d *DB) Close() error {
	return d.db.Close()
}

// --- Authorized Keys (X25519) ---

// AddAuthorizedX25519Key stores a user's X25519 public key as an authorized key.
func (d *DB) AddAuthorizedX25519Key(x25519PubKey []byte, username string) error {
	_, err := d.db.Exec(
		`INSERT OR REPLACE INTO authorized_keys (x25519_public_key, username, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
		x25519PubKey, username,
	)
	if err != nil {
		return err
	}
	return d.reloadAuthKeys()
}

// IsX25519KeyAuthorized checks the in-memory cache. Returns (username, true) if authorized.
func (d *DB) IsX25519KeyAuthorized(keyID string) (string, bool) {
	d.authKeysMu.RLock()
	defer d.authKeysMu.RUnlock()
	username, ok := d.authKeys[keyID]
	return username, ok
}

// DeleteAuthorizedX25519Key removes an authorized key by its base64url-encoded X25519 public key.
func (d *DB) DeleteAuthorizedX25519Key(keyID string) error {
	keyBytes, err := base64.RawURLEncoding.DecodeString(keyID)
	if err != nil {
		return fmt.Errorf("invalid key_id: %w", err)
	}
	_, err = d.db.Exec(`DELETE FROM authorized_keys WHERE x25519_public_key = ?`, keyBytes)
	if err != nil {
		return err
	}
	return d.reloadAuthKeys()
}

func (d *DB) reloadAuthKeys() error {
	rows, err := d.db.Query(`SELECT x25519_public_key, username FROM authorized_keys`)
	if err != nil {
		return err
	}
	defer rows.Close()

	keys := make(map[string]string)
	for rows.Next() {
		var keyBytes []byte
		var user string
		if err := rows.Scan(&keyBytes, &user); err != nil {
			return err
		}
		keyID := base64.RawURLEncoding.EncodeToString(keyBytes)
		keys[keyID] = user
	}

	d.authKeysMu.Lock()
	d.authKeys = keys
	d.authKeysMu.Unlock()
	return nil
}

// ListAuthorizedKeys returns X25519 public keys for all authorized users.
func (d *DB) ListAuthorizedKeys() []*ecdh.PublicKey {
	rows, err := d.db.Query(`SELECT x25519_public_key FROM authorized_keys`)
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

// GetX25519KeyByPublicBytes looks up an authorized user's X25519 public key by the raw key bytes.
func (d *DB) GetX25519KeyByPublicBytes(x25519PubBytes []byte) (*ecdh.PublicKey, error) {
	var keyBytes []byte
	err := d.db.QueryRow(
		`SELECT x25519_public_key FROM authorized_keys WHERE x25519_public_key = ?`,
		x25519PubBytes,
	).Scan(&keyBytes)
	if err != nil {
		return nil, err
	}
	return ecdh.X25519().NewPublicKey(keyBytes)
}

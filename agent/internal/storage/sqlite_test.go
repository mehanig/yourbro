package storage

import (
	"encoding/base64"
	"testing"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := NewDB(":memory:")
	if err != nil {
		t.Fatalf("NewDB(:memory:): %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// --- Authorized Keys (X25519) ---

func TestAuthorizedKeys_AddAndCheck(t *testing.T) {
	db := newTestDB(t)
	key := make([]byte, 32)
	key[0] = 1
	keyID := base64.RawURLEncoding.EncodeToString(key)

	if err := db.AddAuthorizedX25519Key(key, "alice"); err != nil {
		t.Fatal(err)
	}
	username, ok := db.IsX25519KeyAuthorized(keyID)
	if !ok {
		t.Fatal("key should be authorized")
	}
	if username != "alice" {
		t.Fatalf("want username alice, got %s", username)
	}
}

func TestAuthorizedKeys_NotFound(t *testing.T) {
	db := newTestDB(t)
	_, ok := db.IsX25519KeyAuthorized("nonexistent")
	if ok {
		t.Fatal("nonexistent key should not be authorized")
	}
}

func TestAuthorizedKeys_Delete(t *testing.T) {
	db := newTestDB(t)
	key := make([]byte, 32)
	key[0] = 1
	keyID := base64.RawURLEncoding.EncodeToString(key)

	if err := db.AddAuthorizedX25519Key(key, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := db.DeleteAuthorizedX25519Key(keyID); err != nil {
		t.Fatal(err)
	}
	_, ok := db.IsX25519KeyAuthorized(keyID)
	if ok {
		t.Fatal("deleted key should not be authorized")
	}
}

func TestAuthorizedKeys_DeleteReloadsCache(t *testing.T) {
	db := newTestDB(t)
	key := make([]byte, 32)
	key[0] = 1
	keyID := base64.RawURLEncoding.EncodeToString(key)

	if err := db.AddAuthorizedX25519Key(key, "alice"); err != nil {
		t.Fatal(err)
	}
	if _, ok := db.IsX25519KeyAuthorized(keyID); !ok {
		t.Fatal("key should be in cache")
	}
	if err := db.DeleteAuthorizedX25519Key(keyID); err != nil {
		t.Fatal(err)
	}
	if _, ok := db.IsX25519KeyAuthorized(keyID); ok {
		t.Fatal("deleted key should not be in cache")
	}
}

func TestAuthorizedKeys_DuplicateKey(t *testing.T) {
	db := newTestDB(t)
	key := make([]byte, 32)
	key[0] = 1
	keyID := base64.RawURLEncoding.EncodeToString(key)

	if err := db.AddAuthorizedX25519Key(key, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := db.AddAuthorizedX25519Key(key, "bob"); err != nil {
		t.Fatal(err)
	}
	username, ok := db.IsX25519KeyAuthorized(keyID)
	if !ok {
		t.Fatal("key should still be authorized")
	}
	if username != "bob" {
		t.Fatalf("want username bob, got %s", username)
	}
}

func TestAuthorizedKeys_DeleteNonexistent(t *testing.T) {
	db := newTestDB(t)
	key := make([]byte, 32)
	keyID := base64.RawURLEncoding.EncodeToString(key)
	if err := db.DeleteAuthorizedX25519Key(keyID); err != nil {
		t.Fatalf("deleting nonexistent key should not error: %v", err)
	}
}

// --- Storage ---

func TestStorage_SetAndGet(t *testing.T) {
	db := newTestDB(t)
	if err := db.Set("page1", "counter", `{"count":42}`); err != nil {
		t.Fatal(err)
	}
	entry, err := db.Get("page1", "counter")
	if err != nil {
		t.Fatal(err)
	}
	if entry.PageSlug != "page1" || entry.Key != "counter" || entry.Value != `{"count":42}` {
		t.Fatalf("unexpected entry: %+v", entry)
	}
}

func TestStorage_GetNotFound(t *testing.T) {
	db := newTestDB(t)
	_, err := db.Get("page1", "missing")
	if err == nil {
		t.Fatal("expected error for missing key")
	}
}

func TestStorage_Upsert(t *testing.T) {
	db := newTestDB(t)
	if err := db.Set("page1", "k", `"v1"`); err != nil {
		t.Fatal(err)
	}
	if err := db.Set("page1", "k", `"v2"`); err != nil {
		t.Fatal(err)
	}
	entry, err := db.Get("page1", "k")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Value != `"v2"` {
		t.Fatalf("want v2, got %s", entry.Value)
	}
}

func TestStorage_Delete(t *testing.T) {
	db := newTestDB(t)
	if err := db.Set("page1", "k", `"v"`); err != nil {
		t.Fatal(err)
	}
	if err := db.Delete("page1", "k"); err != nil {
		t.Fatal(err)
	}
	_, err := db.Get("page1", "k")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestStorage_DeleteNonexistent(t *testing.T) {
	db := newTestDB(t)
	if err := db.Delete("page1", "missing"); err != nil {
		t.Fatalf("deleting nonexistent key should not error: %v", err)
	}
}

func TestStorage_List(t *testing.T) {
	db := newTestDB(t)
	db.Set("page1", "b", `"B"`)
	db.Set("page1", "a", `"A"`)
	db.Set("page1", "c", `"C"`)

	entries, err := db.List("page1", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("want 3 entries, got %d", len(entries))
	}
	// Should be ordered by key
	if entries[0].Key != "a" || entries[1].Key != "b" || entries[2].Key != "c" {
		t.Fatalf("entries not ordered: %v", entries)
	}
}

func TestStorage_ListWithPrefix(t *testing.T) {
	db := newTestDB(t)
	db.Set("page1", "user:1", `"Alice"`)
	db.Set("page1", "user:2", `"Bob"`)
	db.Set("page1", "config:theme", `"dark"`)

	entries, err := db.List("page1", "user:")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("want 2 entries, got %d", len(entries))
	}
}

func TestStorage_ListPrefixEscaping(t *testing.T) {
	db := newTestDB(t)
	db.Set("page1", "test%special", `"yes"`)
	db.Set("page1", "testXYZ", `"no"`)

	// Prefix "test%" should match literal "test%..." not "testXYZ"
	entries, err := db.List("page1", "test%")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("want 1 entry (escaped %%), got %d", len(entries))
	}
	if entries[0].Key != "test%special" {
		t.Fatalf("want test%%special, got %s", entries[0].Key)
	}
}

func TestStorage_ListEmpty(t *testing.T) {
	db := newTestDB(t)
	entries, err := db.List("empty-slug", "")
	if err != nil {
		t.Fatal(err)
	}
	if entries != nil && len(entries) != 0 {
		t.Fatalf("want nil or empty, got %d entries", len(entries))
	}
}

func TestStorage_IsolationBetweenSlugs(t *testing.T) {
	db := newTestDB(t)
	db.Set("page-a", "key", `"from-a"`)
	db.Set("page-b", "key", `"from-b"`)

	a, err := db.Get("page-a", "key")
	if err != nil {
		t.Fatal(err)
	}
	b, err := db.Get("page-b", "key")
	if err != nil {
		t.Fatal(err)
	}
	if a.Value != `"from-a"` || b.Value != `"from-b"` {
		t.Fatalf("slugs not isolated: a=%s b=%s", a.Value, b.Value)
	}
}

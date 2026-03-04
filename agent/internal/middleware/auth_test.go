package middleware

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mehanig/yourbro/agent/internal/storage"
)

func newTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.NewDB(":memory:")
	if err != nil {
		t.Fatalf("NewDB(:memory:): %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func testKeypair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

func keyID(pub ed25519.PublicKey) string {
	return base64.RawURLEncoding.EncodeToString(pub)
}

// signReq signs an HTTP request with RFC 9421 headers matching the middleware's format.
func signReq(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey) {
	signReqFull(r, priv, pub, time.Now(), fmt.Sprintf("nonce-%d", time.Now().UnixNano()), false, "")
}

func signReqWithTime(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, created time.Time) {
	signReqFull(r, priv, pub, created, fmt.Sprintf("nonce-%d", time.Now().UnixNano()), false, "")
}

func signReqWithNonce(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, nonce string) {
	signReqFull(r, priv, pub, time.Now(), nonce, false, "")
}

func signReqWithBody(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, body string) {
	signReqFull(r, priv, pub, time.Now(), fmt.Sprintf("nonce-%d", time.Now().UnixNano()), true, body)
}

func signReqFull(r *http.Request, priv ed25519.PrivateKey, pub ed25519.PublicKey, created time.Time, nonce string, hasBody bool, body string) {
	kid := keyID(pub)
	createdStr := fmt.Sprintf("%d", created.Unix())

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	targetURI := fmt.Sprintf("%s://%s%s", scheme, r.Host, r.RequestURI)

	var contentDigest string
	if hasBody {
		hash := sha256.Sum256([]byte(body))
		contentDigest = fmt.Sprintf("sha-256=:%s:", base64.StdEncoding.EncodeToString(hash[:]))
		r.Header.Set("Content-Digest", contentDigest)
	}

	var covered string
	var lines []string
	if hasBody {
		covered = `("@method" "@target-uri" "content-digest")`
		lines = []string{
			fmt.Sprintf(`"@method": %s`, r.Method),
			fmt.Sprintf(`"@target-uri": %s`, targetURI),
			fmt.Sprintf(`"content-digest": %s`, contentDigest),
		}
	} else {
		covered = `("@method" "@target-uri")`
		lines = []string{
			fmt.Sprintf(`"@method": %s`, r.Method),
			fmt.Sprintf(`"@target-uri": %s`, targetURI),
		}
	}

	sigParams := fmt.Sprintf(`%s;created=%s;nonce="%s";keyid="%s"`, covered, createdStr, nonce, kid)
	lines = append(lines, fmt.Sprintf(`"@signature-params": %s`, sigParams))
	signatureBase := strings.Join(lines, "\n")

	sig := ed25519.Sign(priv, []byte(signatureBase))
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	r.Header.Set("Signature-Input", "sig1="+sigParams)
	r.Header.Set("Signature", fmt.Sprintf("sig1=:%s:", sigB64))
}

func TestVerifyUserSignature(t *testing.T) {
	db := newTestDB(t)
	pub, priv := testKeypair(t)
	kid := keyID(pub)

	if err := db.AddAuthorizedKey(kid, "testuser"); err != nil {
		t.Fatal(err)
	}

	okHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUsername(r)
		pk := GetPublicKey(r)
		w.Write([]byte(fmt.Sprintf("user=%s key=%s", user, pk)))
	})

	tests := []struct {
		name       string
		setup      func(r *http.Request)
		wantStatus int
		wantBody   string
	}{
		{
			name: "valid signature passes",
			setup: func(r *http.Request) {
				signReq(r, priv, pub)
			},
			wantStatus: http.StatusOK,
			wantBody:   "user=testuser",
		},
		{
			name: "context has public key",
			setup: func(r *http.Request) {
				signReq(r, priv, pub)
			},
			wantStatus: http.StatusOK,
			wantBody:   "key=" + kid,
		},
		{
			name:       "missing Signature-Input header",
			setup:      func(r *http.Request) { r.Header.Set("Signature", "sig1=:AAAA:") },
			wantStatus: http.StatusUnauthorized,
			wantBody:   "missing Signature-Input",
		},
		{
			name:       "missing Signature header",
			setup:      func(r *http.Request) { r.Header.Set("Signature-Input", "sig1=test") },
			wantStatus: http.StatusUnauthorized,
			wantBody:   "missing Signature-Input",
		},
		{
			name: "missing both headers",
			setup: func(r *http.Request) {
				// no headers
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "missing Signature-Input",
		},
		{
			name: "malformed Signature-Input no equals",
			setup: func(r *http.Request) {
				r.Header.Set("Signature-Input", "noequalssign")
				r.Header.Set("Signature", "sig1=:AAAA:")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "malformed Signature-Input",
		},
		{
			name: "malformed covered components no parens",
			setup: func(r *http.Request) {
				r.Header.Set("Signature-Input", `sig1=noparens;created=123;nonce="n";keyid="k"`)
				r.Header.Set("Signature", "sig1=:AAAA:")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "malformed covered components",
		},
		{
			name: "missing keyid param",
			setup: func(r *http.Request) {
				r.Header.Set("Signature-Input", `sig1=("@method");created=123;nonce="missing-keyid-nonce"`)
				r.Header.Set("Signature", "sig1=:AAAA:")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "missing required signature params",
		},
		{
			name: "missing created param",
			setup: func(r *http.Request) {
				r.Header.Set("Signature-Input", fmt.Sprintf(`sig1=("@method");nonce="missing-created-nonce";keyid="%s"`, kid))
				r.Header.Set("Signature", "sig1=:AAAA:")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "missing required signature params",
		},
		{
			name: "missing nonce param",
			setup: func(r *http.Request) {
				r.Header.Set("Signature-Input", fmt.Sprintf(`sig1=("@method");created=123;keyid="%s"`, kid))
				r.Header.Set("Signature", "sig1=:AAAA:")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "missing required signature params",
		},
		{
			name: "non-numeric created value",
			setup: func(r *http.Request) {
				r.Header.Set("Signature-Input", fmt.Sprintf(`sig1=("@method");created="abc";nonce="non-numeric-nonce";keyid="%s"`, kid))
				r.Header.Set("Signature", "sig1=:AAAA:")
			},
			wantStatus: http.StatusUnauthorized,
			// created parsed as string via regex match[2], parseInt fails
		},
		{
			name: "timestamp too old (301 seconds)",
			setup: func(r *http.Request) {
				signReqWithTime(r, priv, pub, time.Now().Add(-301*time.Second))
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "timestamp too old",
		},
		{
			name: "timestamp too far in future (301 seconds)",
			setup: func(r *http.Request) {
				signReqWithTime(r, priv, pub, time.Now().Add(301*time.Second))
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "timestamp too old",
		},
		{
			name: "timestamp at exact boundary (300 seconds) passes",
			setup: func(r *http.Request) {
				signReqWithTime(r, priv, pub, time.Now().Add(-300*time.Second))
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "tampered signature returns 401",
			setup: func(r *http.Request) {
				signReq(r, priv, pub)
				r.Header.Set("Signature", "sig1=:"+base64.StdEncoding.EncodeToString([]byte("tampered"))+":")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "invalid signature",
		},
		{
			name: "unknown key returns 403 (not 401)",
			setup: func(r *http.Request) {
				unknownPub, unknownPriv := testKeypair(t)
				signReq(r, unknownPriv, unknownPub)
			},
			wantStatus: http.StatusForbidden,
			wantBody:   "not authorized",
		},
		{
			name: "timing oracle: invalid sig + unauthorized key = 401 not 403",
			setup: func(r *http.Request) {
				// Sign with unknown key but tamper the signature
				unknownPub, unknownPriv := testKeypair(t)
				signReq(r, unknownPriv, unknownPub)
				r.Header.Set("Signature", "sig1=:"+base64.StdEncoding.EncodeToString([]byte("bad"))+":")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "invalid signature",
		},
		{
			name: "invalid keyid not valid base64",
			setup: func(r *http.Request) {
				nonce := fmt.Sprintf("bad-b64-%d", time.Now().UnixNano())
				r.Header.Set("Signature-Input", `sig1=("@method" "@target-uri");created=`+fmt.Sprintf("%d", time.Now().Unix())+`;nonce="`+nonce+`";keyid="not-valid-base64!!!"`)
				r.Header.Set("Signature", "sig1=:AAAA:")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "invalid keyid",
		},
		{
			name: "invalid keyid wrong length (16 bytes)",
			setup: func(r *http.Request) {
				shortKey := base64.RawURLEncoding.EncodeToString(make([]byte, 16))
				nonce := fmt.Sprintf("unique-keylen-%d", time.Now().UnixNano())
				r.Header.Set("Signature-Input", `sig1=("@method" "@target-uri");created=`+fmt.Sprintf("%d", time.Now().Unix())+`;nonce="`+nonce+`";keyid="`+shortKey+`"`)
				r.Header.Set("Signature", "sig1=:AAAA:")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "invalid keyid",
		},
		{
			name: "malformed Signature header format",
			setup: func(r *http.Request) {
				signReq(r, priv, pub)
				r.Header.Set("Signature", "wrong-format")
			},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "malformed Signature header",
		},
	}

	middleware := VerifyUserSignature(db)
	handler := middleware(okHandler)

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "http://localhost/api/storage/test/key1", nil)
			tt.setup(req)

			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status: want %d, got %d (body: %s)", tt.wantStatus, w.Code, w.Body.String())
			}
			if tt.wantBody != "" && !strings.Contains(w.Body.String(), tt.wantBody) {
				t.Errorf("body: want substring %q, got %q", tt.wantBody, w.Body.String())
			}
		})
	}
}

func TestVerifyUserSignature_NonceReplay(t *testing.T) {
	db := newTestDB(t)
	pub, priv := testKeypair(t)
	kid := keyID(pub)
	db.AddAuthorizedKey(kid, "testuser")

	okHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	middleware := VerifyUserSignature(db)
	handler := middleware(okHandler)

	fixedNonce := "replay-test-nonce"

	// First request with nonce should pass
	req1 := httptest.NewRequest("GET", "http://localhost/api/test", nil)
	signReqWithNonce(req1, priv, pub, fixedNonce)
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("first request: want 200, got %d: %s", w1.Code, w1.Body.String())
	}

	// Second request with same nonce should fail
	req2 := httptest.NewRequest("GET", "http://localhost/api/test", nil)
	signReqWithNonce(req2, priv, pub, fixedNonce)
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != http.StatusUnauthorized {
		t.Fatalf("replayed nonce: want 401, got %d", w2.Code)
	}
	if !strings.Contains(w2.Body.String(), "replay detected") {
		t.Errorf("want 'replay detected', got %s", w2.Body.String())
	}
}

func TestVerifyUserSignature_ConcurrentNonce(t *testing.T) {
	db := newTestDB(t)
	pub, priv := testKeypair(t)
	kid := keyID(pub)
	db.AddAuthorizedKey(kid, "testuser")

	okHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	middleware := VerifyUserSignature(db)
	handler := middleware(okHandler)

	fixedNonce := "concurrent-test-nonce"
	n := 10
	results := make([]int, n)
	var wg sync.WaitGroup
	wg.Add(n)

	for i := 0; i < n; i++ {
		go func(idx int) {
			defer wg.Done()
			req := httptest.NewRequest("GET", "http://localhost/api/test", nil)
			signReqWithNonce(req, priv, pub, fixedNonce)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			results[idx] = w.Code
		}(i)
	}
	wg.Wait()

	successes := 0
	for _, code := range results {
		if code == http.StatusOK {
			successes++
		}
	}
	if successes != 1 {
		t.Errorf("want exactly 1 success, got %d (results: %v)", successes, results)
	}
}

func TestVerifyUserSignature_ContentDigest(t *testing.T) {
	db := newTestDB(t)
	pub, priv := testKeypair(t)
	kid := keyID(pub)
	db.AddAuthorizedKey(kid, "testuser")

	okHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	middleware := VerifyUserSignature(db)
	handler := middleware(okHandler)

	t.Run("valid content-digest passes", func(t *testing.T) {
		body := `{"key":"value"}`
		req := httptest.NewRequest("PUT", "http://localhost/api/storage/test/key1", strings.NewReader(body))
		signReqWithBody(req, priv, pub, body)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("mismatched content-digest rejected", func(t *testing.T) {
		body := `{"key":"value"}`
		req := httptest.NewRequest("PUT", "http://localhost/api/storage/test/key1", strings.NewReader(body))
		// Sign with one body but send different content-digest
		signReqWithBody(req, priv, pub, body)
		// Overwrite Content-Digest with hash of different body
		fakeHash := sha256.Sum256([]byte("different body"))
		req.Header.Set("Content-Digest", fmt.Sprintf("sha-256=:%s:", base64.StdEncoding.EncodeToString(fakeHash[:])))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		// The signature was computed over the original Content-Digest, so now the
		// signature verification should fail because the Content-Digest header changed
		if w.Code == http.StatusOK {
			t.Fatal("mismatched content-digest should not pass")
		}
	})

	t.Run("content-digest mismatch with body", func(t *testing.T) {
		// Sign request normally, then change the body (but keep headers)
		realBody := `{"key":"value"}`
		fakeBody := `{"key":"EVIL"}`
		req := httptest.NewRequest("PUT", "http://localhost/api/storage/test/key1", strings.NewReader(fakeBody))
		signReqWithBody(req, priv, pub, realBody)
		// Content-Digest matches realBody, but request body is fakeBody
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body tampering: want 400, got %d: %s", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "content-digest mismatch") {
			t.Errorf("want 'content-digest mismatch', got %s", w.Body.String())
		}
	})
}

// --- Nonce Cache Unit Tests ---

func TestNonceCache_Seen(t *testing.T) {
	cache := newNonceCache(5 * time.Minute)
	if cache.seen("nonce1") {
		t.Fatal("new nonce should not be seen")
	}
	if !cache.seen("nonce1") {
		t.Fatal("repeated nonce should be seen")
	}
}

func TestNonceCache_DifferentNonces(t *testing.T) {
	cache := newNonceCache(5 * time.Minute)
	if cache.seen("a") {
		t.Fatal("a should not be seen")
	}
	if cache.seen("b") {
		t.Fatal("b should not be seen")
	}
	if !cache.seen("a") {
		t.Fatal("a should now be seen")
	}
}

func TestNonceCache_ConcurrentAccess(t *testing.T) {
	cache := newNonceCache(5 * time.Minute)
	var wg sync.WaitGroup
	n := 100
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			cache.seen(fmt.Sprintf("nonce-%d", i))
		}(i)
	}
	wg.Wait()
	// All nonces should now be seen
	for i := 0; i < n; i++ {
		if !cache.seen(fmt.Sprintf("nonce-%d", i)) {
			t.Errorf("nonce-%d should be seen", i)
		}
	}
}

// --- Context Helpers ---

func TestGetUsername_Empty(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	if username := GetUsername(req); username != "" {
		t.Fatalf("want empty, got %s", username)
	}
}

func TestGetPublicKey_Empty(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	if pk := GetPublicKey(req); pk != "" {
		t.Fatalf("want empty, got %s", pk)
	}
}

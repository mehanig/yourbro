package handlers

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io/fs"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
)

var validSlug = regexp.MustCompile(`^[a-z0-9-]+$`)

// Ambiguity-free charset: no 0/O/1/I
const accessCodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

type PagesHandler struct {
	PagesDir string
	DB       interface{ IsX25519KeyAuthorized(keyID string) (string, bool) }
}

type pageMeta struct {
	Title         string   `json:"title"`
	Public        bool     `json:"public"`
	AllowedEmails []string `json:"allowed_emails,omitempty"`
	AccessCode    string   `json:"access_code,omitempty"`
}

type pageSummary struct {
	Slug          string   `json:"slug"`
	Title         string   `json:"title"`
	Public        bool     `json:"public"`
	Shared        bool     `json:"shared"`
	AllowedEmails []string `json:"allowed_emails,omitempty"`
}

type pageBundle struct {
	Slug   string            `json:"slug"`
	Title  string            `json:"title"`
	Public bool              `json:"public"`
	Files  map[string]string `json:"files"`
}

func (m *pageMeta) isEmailAllowed(email string) bool {
	for _, e := range m.AllowedEmails {
		if strings.EqualFold(e, email) {
			return true
		}
	}
	return false
}

func (h *PagesHandler) List(w http.ResponseWriter, r *http.Request) {
	if !h.isPairedUser(KeyIDFromRequest(r)) {
		writeJSON(w, http.StatusOK, []pageSummary{})
		return
	}

	entries, err := os.ReadDir(h.PagesDir)
	if err != nil {
		writeJSON(w, http.StatusOK, []pageSummary{})
		return
	}

	var pages []pageSummary
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		slug := entry.Name()
		if !validSlug.MatchString(slug) {
			continue
		}
		// Must contain index.html
		if _, err := os.Stat(filepath.Join(h.PagesDir, slug, "index.html")); err != nil {
			continue
		}
		meta := readPageMeta(h.PagesDir, slug)
		pages = append(pages, pageSummary{
			Slug:          slug,
			Title:         meta.Title,
			Public:        meta.Public,
			Shared:        len(meta.AllowedEmails) > 0,
			AllowedEmails: meta.AllowedEmails,
		})
	}

	if pages == nil {
		pages = []pageSummary{}
	}
	writeJSON(w, http.StatusOK, pages)
}

// buildBundle reads all files for a page slug and returns the bundle.
// Returns nil if the page doesn't exist or the slug is invalid.
func (h *PagesHandler) buildBundle(slug string) (*pageBundle, int) {
	if !validSlug.MatchString(slug) {
		return nil, http.StatusBadRequest
	}

	dirPath := filepath.Join(h.PagesDir, slug)
	// Path traversal check: resolved path must be under PagesDir
	resolved, err := filepath.EvalSymlinks(dirPath)
	if err != nil {
		return nil, http.StatusNotFound
	}
	absPages, _ := filepath.Abs(h.PagesDir)
	if !strings.HasPrefix(resolved, absPages+string(os.PathSeparator)) {
		return nil, http.StatusBadRequest
	}

	// Must have index.html
	if _, err := os.Stat(filepath.Join(dirPath, "index.html")); err != nil {
		return nil, http.StatusNotFound
	}

	files := make(map[string]string)
	var totalSize int64
	const maxFileSize = 1 << 20   // 1MB per file
	const maxBundleSize = 10 << 20 // 10MB total

	// Text file extensions — everything else is base64-encoded with "base64:" prefix
	textExts := map[string]bool{
		".html": true, ".htm": true, ".css": true, ".js": true, ".mjs": true,
		".json": true, ".svg": true, ".txt": true, ".xml": true, ".md": true,
	}

	err = filepath.WalkDir(dirPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != dirPath {
				return fs.SkipDir
			}
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.Size() > maxFileSize {
			return nil
		}
		if totalSize+info.Size() > maxBundleSize {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		totalSize += info.Size()
		relName := d.Name()
		ext := strings.ToLower(filepath.Ext(relName))
		if textExts[ext] {
			files[relName] = string(content)
		} else {
			files[relName] = "base64:" + base64.StdEncoding.EncodeToString(content)
		}
		return nil
	})
	if err != nil {
		return nil, http.StatusInternalServerError
	}

	meta := readPageMeta(h.PagesDir, slug)
	return &pageBundle{
		Slug:   slug,
		Title:  meta.Title,
		Public: meta.Public,
		Files:  files,
	}, http.StatusOK
}

// Get serves a page bundle. Access control tiers:
//  1. Paired user (key_id in authorized_keys) -> any page
//  2. Shared page: verified email in allowed_emails AND correct access_code
//  3. Public page (public:true) -> anyone
func (h *PagesHandler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	keyID := KeyIDFromRequest(r)
	meta := readPageMeta(h.PagesDir, slug)

	// Tier 1: Paired user -> any page
	if h.isPairedUser(keyID) {
		h.servePage(w, slug)
		return
	}

	// Tier 2: Shared page — requires BOTH email match AND correct access code
	if len(meta.AllowedEmails) > 0 && meta.AccessCode != "" {
		email := IdentityEmailFromRequest(r)
		code := AccessCodeFromRequest(r)

		// No identity token — viewer needs to log in
		if email == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "login_required"})
			return
		}

		// Email not in allowed list
		if !meta.isEmailAllowed(email) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "email_not_allowed"})
			return
		}

		// Email matches — check access code
		if code == "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "access_code_required"})
			return
		}
		if subtle.ConstantTimeCompare([]byte(code), []byte(meta.AccessCode)) == 1 {
			h.servePage(w, slug)
			return
		}
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid_access_code"})
		return
	}

	// Tier 3: Public page -> anyone
	if meta.Public {
		h.servePage(w, slug)
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
}

func (h *PagesHandler) servePage(w http.ResponseWriter, slug string) {
	bundle, status := h.buildBundle(slug)
	if bundle == nil {
		writeJSON(w, status, map[string]string{"error": "page not found"})
		return
	}
	writeJSON(w, http.StatusOK, bundle)
}

// isPairedUser checks if the key_id belongs to an authorized (paired) user.
func (h *PagesHandler) isPairedUser(keyID string) bool {
	if keyID == "" || h.DB == nil {
		return false
	}
	_, ok := h.DB.IsX25519KeyAuthorized(keyID)
	return ok
}

// readPageMeta reads page.json metadata. Falls back to slug for title.
// Auto-generates access_code when allowed_emails is set but no code exists.
func readPageMeta(pagesDir, slug string) pageMeta {
	metaPath := filepath.Join(pagesDir, slug, "page.json")
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return pageMeta{Title: slug}
	}
	var meta pageMeta
	if json.Unmarshal(data, &meta) != nil || meta.Title == "" {
		meta.Title = slug
	}

	// Auto-generate access code when allowed_emails is set but no code exists
	if len(meta.AllowedEmails) > 0 && meta.AccessCode == "" {
		meta.AccessCode = generateAccessCode()
		// Write back to page.json
		if updated, err := json.MarshalIndent(meta, "", "  "); err == nil {
			if err := os.WriteFile(metaPath, updated, 0644); err == nil {
				log.Printf("=== ACCESS CODE for page %q: %s ===", slug, meta.AccessCode)
				log.Printf("Share this code with invited viewers.")
			}
		}
	}

	return meta
}

// generateAccessCode creates an 8-character code from an ambiguity-free charset.
func generateAccessCode() string {
	code := make([]byte, 8)
	for i := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(accessCodeChars))))
		if err != nil {
			// crypto/rand should never fail; fall back to a known value
			code[i] = accessCodeChars[0]
			continue
		}
		code[i] = accessCodeChars[n.Int64()]
	}
	return string(code)
}

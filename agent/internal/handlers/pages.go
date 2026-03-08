package handlers

import (
	"encoding/base64"
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
)

var validSlug = regexp.MustCompile(`^[a-z0-9-]+$`)

type PagesHandler struct {
	PagesDir string
	DB       interface{ IsX25519KeyAuthorized(keyID string) (string, bool) }
}

type pageMeta struct {
	Title  string `json:"title"`
	Public bool   `json:"public"`
}

type pageSummary struct {
	Slug   string `json:"slug"`
	Title  string `json:"title"`
	Public bool   `json:"public"`
}

type pageBundle struct {
	Slug   string            `json:"slug"`
	Title  string            `json:"title"`
	Public bool              `json:"public"`
	Files  map[string]string `json:"files"`
}

func (h *PagesHandler) List(w http.ResponseWriter, r *http.Request) {
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
		pages = append(pages, pageSummary{Slug: slug, Title: meta.Title, Public: meta.Public})
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

// Get serves a page bundle. Access control is based on X-Yourbro-Key-ID:
// paired user (key_id in authorized_keys) → any page; anonymous → public:true only.
func (h *PagesHandler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	keyID := r.Header.Get("X-Yourbro-Key-ID")
	isPaired := h.isPairedUser(keyID)
	meta := readPageMeta(h.PagesDir, slug)

	if !isPaired && !meta.Public {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

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

// readPageMeta reads page.json metadata (title, public flag). Falls back to slug for title.
func readPageMeta(pagesDir, slug string) pageMeta {
	data, err := os.ReadFile(filepath.Join(pagesDir, slug, "page.json"))
	if err != nil {
		return pageMeta{Title: slug}
	}
	var meta pageMeta
	if json.Unmarshal(data, &meta) != nil || meta.Title == "" {
		meta.Title = slug
	}
	return meta
}

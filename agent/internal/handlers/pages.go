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
}

type pageSummary struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

type pageBundle struct {
	Slug  string            `json:"slug"`
	Title string            `json:"title"`
	Files map[string]string `json:"files"`
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
		title := readTitle(h.PagesDir, slug)
		pages = append(pages, pageSummary{Slug: slug, Title: title})
	}

	if pages == nil {
		pages = []pageSummary{}
	}
	writeJSON(w, http.StatusOK, pages)
}

func (h *PagesHandler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !validSlug.MatchString(slug) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid slug"})
		return
	}

	dirPath := filepath.Join(h.PagesDir, slug)
	// Path traversal check: resolved path must be under PagesDir
	resolved, err := filepath.EvalSymlinks(dirPath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}
	absPages, _ := filepath.Abs(h.PagesDir)
	if !strings.HasPrefix(resolved, absPages+string(os.PathSeparator)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid slug"})
		return
	}

	// Must have index.html
	if _, err := os.Stat(filepath.Join(dirPath, "index.html")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

	files := make(map[string]string)
	var totalSize int64
	const maxFileSize = 1 << 20  // 1MB per file
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
			// Skip subdirectories (only top-level files)
			if path != dirPath {
				return fs.SkipDir
			}
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return nil // skip unreadable files
		}
		if info.Size() > maxFileSize {
			return nil // skip files > 1MB
		}
		if totalSize+info.Size() > maxBundleSize {
			return nil // skip if total would exceed 10MB
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
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to read page"})
		return
	}

	title := readTitle(h.PagesDir, slug)
	writeJSON(w, http.StatusOK, pageBundle{
		Slug:  slug,
		Title: title,
		Files: files,
	})
}

// readTitle reads the title from page.json, falls back to slug.
func readTitle(pagesDir, slug string) string {
	data, err := os.ReadFile(filepath.Join(pagesDir, slug, "page.json"))
	if err != nil {
		return slug
	}
	var meta struct {
		Title string `json:"title"`
	}
	if json.Unmarshal(data, &meta) == nil && meta.Title != "" {
		return meta.Title
	}
	return slug
}

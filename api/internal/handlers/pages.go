package handlers

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/api/internal/auth"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/storage"
)

var slugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

type PagesHandler struct {
	DB        *storage.DB
	AllowHTTP bool   // allow http:// agent endpoints (dev mode)
	SDKScript string // inline SDK JavaScript (set at startup)
}

func (h *PagesHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req models.CreatePageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	if !slugRegex.MatchString(req.Slug) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid slug: lowercase alphanumeric and hyphens only"})
		return
	}
	if req.Title == "" {
		req.Title = req.Slug
	}
	if req.HTMLContent == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "html_content is required"})
		return
	}

	// Validate agent endpoint URL if provided
	var agentEndpoint *string
	if req.AgentEndpoint != "" {
		if strings.HasPrefix(req.AgentEndpoint, "relay:") {
			// Relay mode: agent_endpoint is "relay:{agent_id}" — no URL validation needed
			agentEndpoint = &req.AgentEndpoint
		} else {
			u, err := url.Parse(req.AgentEndpoint)
			if err != nil || (u.Scheme != "https" && !(h.AllowHTTP && u.Scheme == "http")) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agent_endpoint must be a valid HTTPS URL"})
				return
			}
			agentEndpoint = &req.AgentEndpoint
		}
	}

	page, err := h.DB.CreatePage(r.Context(), userID, req.Slug, req.Title, req.HTMLContent, agentEndpoint)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create page"})
		return
	}

	writeJSON(w, http.StatusCreated, page)
}

func (h *PagesHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	pages, err := h.DB.ListPages(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list pages"})
		return
	}
	if pages == nil {
		pages = []models.Page{}
	}
	writeJSON(w, http.StatusOK, pages)
}

func (h *PagesHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid page id"})
		return
	}

	page, err := h.DB.GetPage(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

	userID := middleware.GetUserID(r)
	if page.UserID != userID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

	writeJSON(w, http.StatusOK, page)
}

func (h *PagesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid page id"})
		return
	}

	userID := middleware.GetUserID(r)
	if err := h.DB.DeletePage(r.Context(), id, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete page"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// RenderPage serves a published page at /p/:username/:slug
func (h *PagesHandler) RenderPage(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	slug := chi.URLParam(r, "slug")

	user, err := h.DB.GetUserByUsername(r.Context(), username)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	page, err := h.DB.GetPageByUserAndSlug(r.Context(), user.ID, slug)
	if err != nil {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}

	hasAgent := page.AgentEndpoint != nil && *page.AgentEndpoint != ""
	isRelay := hasAgent && strings.HasPrefix(*page.AgentEndpoint, "relay:")

	var agentID string
	if isRelay {
		agentID = strings.TrimPrefix(*page.AgentEndpoint, "relay:")
	}

	tmpl := template.Must(template.New("page").Parse(pageHostTemplate))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	tmpl.Execute(w, map[string]any{
		"Title":    page.Title,
		"PageID":   page.ID,
		"Username": username,
		"Slug":     slug,
		"HasAgent": hasAgent,
		"IsRelay":  isRelay,
		"AgentID":  agentID,
	})
}

// RenderPageContent serves the raw HTML content for iframe embedding.
// If the page has an agent_endpoint, a valid JWT must be provided via ?token= query param.
// Only meta tags for agent endpoint and slug are injected — auth is handled by the SDK via user keypair signatures.
func (h *PagesHandler) RenderPageContent(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	page, err := h.DB.GetPage(r.Context(), id)
	if err != nil {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}

	// The iframe sandbox (allow-scripts only, no allow-same-origin) is the security boundary.
	// Use 'unsafe-inline' so user page content with inline event handlers (onclick etc.) works.
	csp := "default-src 'self' https:; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src *; media-src *;"
	var metaTags string

	if page.AgentEndpoint != nil && *page.AgentEndpoint != "" {
		// Agent pages require authentication — verify JWT from query param
		tokenStr := r.URL.Query().Get("token")
		if tokenStr == "" {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}

		claims, err := auth.ValidateSessionToken(tokenStr)
		if err != nil {
			http.Error(w, "Invalid or expired session", http.StatusUnauthorized)
			return
		}

		// Only the page owner gets agent access
		if claims.UserID != page.UserID {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}

		// Inject SDK and meta tags.
		// SDK is inlined because sandbox="allow-scripts" (no allow-same-origin)
		// prevents the iframe from loading external scripts from the parent origin.
		// Auth is handled by the SDK via user keypair Ed25519 signatures (RFC 9421).
		if agentID, ok := strings.CutPrefix(*page.AgentEndpoint, "relay:"); ok {
			// Relay mode: inject relay meta tags instead of agent endpoint
			metaTags = fmt.Sprintf(
				`<meta name="clawd-relay-mode" content="true">`+"\n"+
					`<meta name="clawd-agent-id" content="%s">`+"\n"+
					`<meta name="clawd-page-slug" content="%s">`+"\n"+
					`<script>%s</script>`,
				template.HTMLEscapeString(agentID),
				template.HTMLEscapeString(page.Slug),
				h.SDKScript,
			)
			csp += " connect-src 'self';"
		} else {
			// Direct mode: inject agent endpoint
			metaTags = fmt.Sprintf(
				`<meta name="clawd-agent-endpoint" content="%s">`+"\n"+
					`<meta name="clawd-page-slug" content="%s">`+"\n"+
					`<script>%s</script>`,
				template.HTMLEscapeString(*page.AgentEndpoint),
				template.HTMLEscapeString(page.Slug),
				h.SDKScript,
			)
			csp += " connect-src 'self' " + *page.AgentEndpoint + ";"
		}
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", csp)
	w.Header().Set("Referrer-Policy", "no-referrer")
	if metaTags != "" {
		content := page.HTMLContent
		if idx := strings.Index(strings.ToLower(content), "</head>"); idx >= 0 {
			content = content[:idx] + metaTags + "\n" + content[idx:]
		} else if idx := strings.Index(strings.ToLower(content), "<head>"); idx >= 0 {
			insertAt := idx + len("<head>")
			content = content[:insertAt] + "\n" + metaTags + content[insertAt:]
		} else {
			content = metaTags + "\n" + content
		}
		fmt.Fprint(w, content)
	} else {
		fmt.Fprint(w, page.HTMLContent)
	}
}

// ContentMeta returns the agent endpoint and slug for a page (headless/CLI access).
func (h *PagesHandler) ContentMeta(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid page id"})
		return
	}

	page, err := h.DB.GetPage(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

	userID := middleware.GetUserID(r)
	if page.UserID != userID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

	resp := map[string]string{"slug": page.Slug}
	if page.AgentEndpoint != nil {
		resp["agent_endpoint"] = *page.AgentEndpoint
	}
	writeJSON(w, http.StatusOK, resp)
}

const pageHostTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{.Title}} — yourbro</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; }
        .frame-container { width: 100%; height: 100vh; }
        iframe { width: 100%; height: 100%; border: none; }
        .auth-msg { display: flex; align-items: center; justify-content: center; height: 100vh; font-size: 18px; color: #888; }
        .auth-msg a { color: #3b82f6; margin-left: 6px; }
    </style>
</head>
<body>
    {{if .HasAgent}}
    <script>
        (async function() {
            var token = localStorage.getItem('yb_session');
            if (!token) {
                document.body.innerHTML = '<div class="auth-msg">Sign in to view this page. <a href="/">Go to login</a></div>';
                return;
            }

            // Load keypairs from IndexedDB (stored by dashboard pairing flow)
            var kp = null;
            var x25519kp = null;
            var agentX25519Key = null;
            try {
                var db = await new Promise(function(res, rej) {
                    var req = indexedDB.open('clawd-keys', 2);
                    req.onupgradeneeded = function() {
                        var d = req.result;
                        if (!d.objectStoreNames.contains('keypair')) d.createObjectStore('keypair');
                        if (!d.objectStoreNames.contains('x25519')) d.createObjectStore('x25519');
                        if (!d.objectStoreNames.contains('agent-keys')) d.createObjectStore('agent-keys');
                    };
                    req.onsuccess = function() { res(req.result); };
                    req.onerror = function() { rej(req.error); };
                });
                kp = await new Promise(function(res, rej) {
                    var tx = db.transaction('keypair', 'readonly');
                    var req = tx.objectStore('keypair').get('default');
                    req.onsuccess = function() { res(req.result || null); };
                    req.onerror = function() { rej(req.error); };
                });
                // Load X25519 keypair for E2E encryption
                x25519kp = await new Promise(function(res, rej) {
                    var tx = db.transaction('x25519', 'readonly');
                    var req = tx.objectStore('x25519').get('default');
                    req.onsuccess = function() { res(req.result || null); };
                    req.onerror = function() { rej(req.error); };
                });
                {{if .IsRelay}}
                // Load agent's X25519 public key for relay E2E
                agentX25519Key = await new Promise(function(res, rej) {
                    var tx = db.transaction('agent-keys', 'readonly');
                    var req = tx.objectStore('agent-keys').get('x25519-{{.AgentID}}');
                    req.onsuccess = function() { res(req.result || null); };
                    req.onerror = function() { rej(req.error); };
                });
                {{end}}
            } catch(e) { /* IndexedDB not available */ }

            if (!kp) {
                document.body.innerHTML = '<div class="auth-msg">No keypair found. <a href="/#/dashboard">Pair your agent first</a></div>';
                return;
            }

            var container = document.createElement('div');
            container.className = 'frame-container';
            var iframe = document.createElement('iframe');
            iframe.src = '/api/pages/{{.PageID}}/content?token=' + encodeURIComponent(token);
            iframe.setAttribute('sandbox', 'allow-scripts');
            iframe.setAttribute('loading', 'lazy');
            container.appendChild(iframe);
            document.body.appendChild(container);

            // Send keypairs to sandboxed iframe via postMessage.
            // CryptoKey objects are structured-cloneable (even non-extractable ones).
            iframe.addEventListener('load', function() {
                var msg = {
                    type: 'clawd-keypair',
                    privateKey: kp.privateKey,
                    publicKeyBytes: kp.publicKeyBytes
                };
                if (x25519kp) {
                    msg.x25519PrivateKey = x25519kp.privateKey;
                    msg.x25519PublicKeyBytes = x25519kp.publicKeyBytes;
                }
                if (agentX25519Key) {
                    msg.agentX25519PublicKeyBytes = agentX25519Key;
                }
                iframe.contentWindow.postMessage(msg, '*');
            });
        })();
    </script>
    {{else}}
    <div class="frame-container">
        <iframe
            src="/api/pages/{{.PageID}}/content"
            sandbox="allow-scripts"
            loading="lazy"
        ></iframe>
    </div>
    {{end}}
</body>
</html>`

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

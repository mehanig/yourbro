package handlers

import (
	"encoding/json"
	"html/template"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/api/internal/relay"
	"github.com/mehanig/yourbro/api/internal/storage"
)

type PagesHandler struct {
	DB        *storage.DB
	Hub       *relay.Hub
	SDKScript string // inline SDK JavaScript (set at startup)
}

// RenderPage serves a published page at /p/:username/:slug.
// The server is a pure relay — it never stores or sees page HTML.
// Page content is fetched on-demand from the agent via WebSocket relay.
func (h *PagesHandler) RenderPage(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	slug := chi.URLParam(r, "slug")

	user, err := h.DB.GetUserByUsername(r.Context(), username)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	// Find all agents for this user (routing without pages table)
	agents, err := h.DB.ListAgents(r.Context(), user.ID)
	if err != nil || len(agents) == 0 {
		http.Error(w, "No agents registered", http.StatusNotFound)
		return
	}

	// Collect agent IDs and check which are online
	type agentInfo struct {
		ID     int64
		Online bool
	}
	var agentInfos []agentInfo
	for _, a := range agents {
		agentInfos = append(agentInfos, agentInfo{
			ID:     a.ID,
			Online: h.Hub.IsOnline(a.ID),
		})
	}

	// Build agent ID list for JS
	var agentIDs []int64
	for _, ai := range agentInfos {
		agentIDs = append(agentIDs, ai.ID)
	}

	// JSON-encode the SDK script for safe injection into JS
	sdkJSON, _ := json.Marshal(h.SDKScript)

	tmpl := template.Must(template.New("page").Parse(pageHostTemplate))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	tmpl.Execute(w, map[string]any{
		"Username":      username,
		"Slug":          slug,
		"AgentIDs":      agentIDs,
		"SDKScriptJSON": template.JS(string(sdkJSON)),
	})
}


const pageHostTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{.Slug}} — yourbro</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; }
        .frame-container { width: 100%; height: 100vh; }
        iframe { width: 100%; height: 100%; border: none; }
        .status-msg {
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; height: 100vh; font-size: 18px; color: #888;
            text-align: center; padding: 20px;
        }
        .status-msg a { color: #3b82f6; margin-top: 8px; }
        .status-msg .subtitle { font-size: 14px; color: #555; margin-top: 6px; }
    </style>
</head>
<body>
    <script>
        (async function() {
            var agentIds = [{{range $i, $id := .AgentIDs}}{{if $i}},{{end}}{{$id}}{{end}}];
            var slug = "{{.Slug}}";
            var sdkScript = {{.SDKScriptJSON}};

            // 1. Verify auth — get content token for iframe SDK relay auth
            var tokenResp = await fetch('/api/content-token', { credentials: 'include' });
            if (!tokenResp.ok) {
                document.body.innerHTML = '<div class="status-msg">Sign in to view this page. <a href="/">Go to login</a></div>';
                return;
            }
            var token = (await tokenResp.json()).token;

            // 2. Load keypairs from IndexedDB (stored by dashboard pairing flow)
            var kp = null;
            var x25519kp = null;
            var agentX25519Keys = {};
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
                x25519kp = await new Promise(function(res, rej) {
                    var tx = db.transaction('x25519', 'readonly');
                    var req = tx.objectStore('x25519').get('default');
                    req.onsuccess = function() { res(req.result || null); };
                    req.onerror = function() { rej(req.error); };
                });
                // Load agent X25519 keys for E2E
                for (var i = 0; i < agentIds.length; i++) {
                    try {
                        var k = await new Promise(function(res, rej) {
                            var tx = db.transaction('agent-keys', 'readonly');
                            var req = tx.objectStore('agent-keys').get('x25519-' + agentIds[i]);
                            req.onsuccess = function() { res(req.result || null); };
                            req.onerror = function() { rej(req.error); };
                        });
                        if (k) agentX25519Keys[agentIds[i]] = k;
                    } catch(e) {}
                }
            } catch(e) { /* IndexedDB not available */ }

            if (!kp) {
                document.body.innerHTML = '<div class="status-msg">No keypair found. <a href="/#/dashboard">Pair your agent first</a></div>';
                return;
            }

            // 3. Fetch page HTML from agent via relay (try each agent)
            var pageHTML = null;
            var pageTitle = null;
            var usedAgentId = null;
            for (var i = 0; i < agentIds.length; i++) {
                try {
                    var resp = await fetch('/api/relay/' + agentIds[i], {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: crypto.randomUUID(),
                            method: 'GET',
                            path: '/api/page/' + encodeURIComponent(slug)
                        })
                    });
                    if (resp.ok) {
                        var envelope = await resp.json();
                        if (envelope.status === 200 && envelope.body) {
                            var pageData = JSON.parse(envelope.body);
                            pageHTML = pageData.html_content;
                            pageTitle = pageData.title || slug;
                            usedAgentId = agentIds[i];
                            break;
                        }
                    }
                } catch(e) {}
            }

            if (!pageHTML) {
                document.body.innerHTML = '<div class="status-msg">' +
                    'Your agent is currently offline.' +
                    '<div class="subtitle">Start your agent to view this page.</div>' +
                    '<a href="/#/dashboard">Go to dashboard</a>' +
                    '</div>';
                return;
            }

            // Update page title
            document.title = pageTitle + ' — yourbro';

            // 4. Build enriched HTML with SDK + meta tags
            var apiBase = window.location.origin;
            var metaTags =
                '<meta name="clawd-relay-mode" content="true">\n' +
                '<meta name="clawd-agent-id" content="' + usedAgentId + '">\n' +
                '<meta name="clawd-page-slug" content="' + slug + '">\n' +
                '<meta name="clawd-api-base" content="' + apiBase + '">\n' +
                '<meta name="clawd-session-token" content="' + token + '">\n' +
                '<script>' + sdkScript + '<\/script>\n';
            var enrichedHTML = metaTags + pageHTML;

            // 5. Create sandboxed iframe with srcdoc
            var container = document.createElement('div');
            container.className = 'frame-container';
            var iframe = document.createElement('iframe');
            iframe.srcdoc = enrichedHTML;
            iframe.setAttribute('sandbox', 'allow-scripts');
            container.appendChild(iframe);
            document.body.appendChild(container);

            // 6. Send keypairs to sandboxed iframe via postMessage
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
                if (agentX25519Keys[usedAgentId]) {
                    msg.agentX25519PublicKeyBytes = agentX25519Keys[usedAgentId];
                }
                iframe.contentWindow.postMessage(msg, '*');
            });
        })();
    </script>
</body>
</html>`

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}


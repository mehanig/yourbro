import {
  getMe,
  listPages,
  listTokens,
  createToken,
  deleteToken,
  deletePage,
  registerAgent,
  deleteAgent,
  clearToken,
  type User,
  type Page,
  type Token,
  type Agent,
} from "../lib/api";
import {
  getOrCreateKeypair,
  getOrCreateX25519Keypair,
  storeAgentX25519Key,
  base64RawUrlEncode,
  base64RawUrlDecode,
  signedFetch,
} from "../lib/crypto";

/** Active SSE connection — closed before re-render to prevent leaks. */
let activeSSE: EventSource | null = null;

/** Escape HTML entities to prevent XSS when interpolating user-controlled data. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAgentsList(agents: Agent[], container: HTMLElement) {
  const listEl = container.querySelector("#agents-list");
  if (!listEl) return;

  // Update relay agent dropdown for pairing
  const relaySelect = container.querySelector("#pair-relay-agent") as HTMLSelectElement | null;
  if (relaySelect) {
    const unpairedRelay = agents.filter(a => !a.endpoint && a.is_online);
    relaySelect.innerHTML = unpairedRelay.length === 0
      ? '<option value="">No relay agents online</option>'
      : unpairedRelay.map(a => `<option value="${a.id}">${esc(a.name || "unnamed")} (#${a.id})</option>`).join("");
  }

  listEl.innerHTML =
    agents.length === 0
      ? '<p style="color:#656d76;">No agents paired yet.</p>'
      : agents
          .map(
            (a) => {
              const isRelay = !a.endpoint;
              const modeLabel = isRelay
                ? '<span style="color:#58a6ff;font-size:0.75rem;padding:0.1rem 0.4rem;background:#0d2a4a;border-radius:4px;margin-left:0.5rem;">relay</span>'
                : `<span style="color:#656d76;margin-left:0.5rem;font-size:0.85rem;">${esc(a.endpoint || "")}</span>`;
              return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:0.5rem;">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <span style="color:${a.is_online ? "#3fb950" : "#656d76"};font-size:1.2rem;">${a.is_online ? "●" : "○"}</span>
              <div>
                <span style="font-weight:600;">${esc(a.name || "unnamed")}</span>
                ${modeLabel}
              </div>
            </div>
            <button class="delete-agent" data-id="${a.id}" data-endpoint="${esc(a.endpoint || "")}" data-relay="${isRelay}" style="padding:0.3rem 0.6rem;background:#2d1214;border:1px solid #5a1d22;color:#f85149;border-radius:4px;cursor:pointer;font-size:0.8rem;">Remove</button>
          </div>
        `;
            }
          )
          .join("");

  // Re-bind delete handlers
  listEl.querySelectorAll(".delete-agent").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const endpoint = (btn as HTMLElement).dataset.endpoint;
      const isRelay = (btn as HTMLElement).dataset.relay === "true";
      if (!confirm("Remove this agent?")) return;

      // Step 1: Revoke key on agent — must succeed before removing server record
      if (isRelay) {
        // Relay mode: send revoke through relay endpoint
        try {
          const { publicKeyBytes } = await getOrCreateKeypair();
          const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);
          const created = Math.floor(Date.now() / 1000);
          const nonce = crypto.randomUUID();
          const sigParams = `("@method" "@target-uri");created=${created};nonce="${nonce}";keyid="${pubKeyB64}"`;
          const signatureBase = `"@method": DELETE\n"@target-uri": https://relay.internal/api/keys\n"@signature-params": ${sigParams}`;
          const sig = await crypto.subtle.sign("Ed25519", (await getOrCreateKeypair()).privateKey, new TextEncoder().encode(signatureBase));
          const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

          const res = await fetch(`/api/relay/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: crypto.randomUUID(),
              method: "DELETE",
              path: "/api/keys",
              headers: {
                "Signature-Input": `sig1=${sigParams}`,
                "Signature": `sig1=:${sigB64}:`,
              },
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: res.statusText }));
            alert(`Can't unpair: ${data.error || res.statusText}`);
            return;
          }
        } catch (err) {
          alert("Can't unpair: relay failed.\n" + (err instanceof Error ? err.message : String(err)));
          return;
        }
      } else if (endpoint) {
        // Direct mode: send revoke directly to agent
        try {
          const res = await signedFetch("DELETE", `${endpoint}/api/keys`);
          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: res.statusText }));
            alert(`Can't unpair: ${data.error || res.statusText}`);
            return;
          }
        } catch {
          alert("Can't unpair: agent is offline or unreachable.\nTry again when the agent is back online.");
          return;
        }
      }

      // Step 2: Agent confirmed revocation — now safe to remove from server
      await deleteAgent(id);
      renderDashboard(container);
    });
  });
}

export async function renderDashboard(container: HTMLElement) {
  // Close previous SSE connection to prevent leaks on re-render
  if (activeSSE) {
    activeSSE.close();
    activeSSE = null;
  }

  container.innerHTML = `<p style="color:#8b949e;">Loading...</p>`;

  let user: User;
  try {
    user = await getMe();
  } catch {
    clearToken();
    window.location.hash = "#/login";
    return;
  }

  const [pages, tokens] = await Promise.all([
    listPages(),
    listTokens(),
  ]).then(([p, t]) => [p || [], t || []] as [Page[], Token[]]);

  container.innerHTML = `
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid #30363d;">
      <h1 style="font-size:1.5rem;font-weight:700;">yourbro</h1>
      <div style="display:flex;align-items:center;gap:1rem;">
        <span style="color:#8b949e;">${esc(user.email)}</span>
        <a href="#/how-to-use" style="color:#58a6ff;text-decoration:none;font-size:0.9rem;">How to Use</a>
        <button id="logout-btn" style="padding:0.4rem 0.8rem;background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:6px;cursor:pointer;">Logout</button>
      </div>
    </header>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">Paired Agents</h2>
      <div id="agents-list">
        <p style="color:#656d76;">Connecting...</p>
      </div>
      <p style="color:#656d76;font-size:0.8rem;margin-top:0.5rem;">● online &nbsp; ○ offline &nbsp; <span style="color:#58a6ff;">relay</span> = connected via WebSocket</p>
    </section>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">Pair New Agent</h2>
      <p style="color:#8b949e;margin-bottom:1rem;font-size:0.9rem;">
        <strong>Relay agents</strong> connect via WebSocket — select one from the list above and enter its pairing code.<br/>
        <strong>Direct agents</strong> need an endpoint URL, pairing code, and optional name.
      </p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <select id="pair-mode" style="padding:0.5rem;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;">
          <option value="relay">Relay agent</option>
          <option value="direct">Direct agent</option>
        </select>
        <select id="pair-relay-agent" style="padding:0.5rem;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;min-width:160px;"></select>
        <input id="pair-endpoint" type="text" placeholder="http://localhost:9443" style="flex:1;min-width:200px;padding:0.5rem;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;display:none;" />
        <input id="pair-code" type="text" placeholder="Pairing code" style="width:140px;padding:0.5rem;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;font-family:monospace;" />
        <input id="pair-name" type="text" placeholder="Name (optional)" style="width:160px;padding:0.5rem;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;display:none;" />
        <button id="pair-btn" style="padding:0.5rem 1rem;background:#1a2e1d;border:1px solid #2a5a30;color:#3fb950;border-radius:6px;cursor:pointer;">Pair</button>
      </div>
      <div id="pair-status" style="margin-top:0.75rem;display:none;padding:0.75rem;border-radius:8px;font-size:0.9rem;"></div>
    </section>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">Pages</h2>
      <div id="pages-list">
        ${
          pages.length === 0
            ? '<p style="color:#656d76;">No pages yet. Use an API token with an AI agent to publish pages.</p>'
            : pages
                .map(
                  (p: Page) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:0.5rem;">
                  <div>
                    <a href="/p/${esc(user.username)}/${esc(p.slug)}" target="_blank" style="color:#58a6ff;text-decoration:none;font-weight:600;">${esc(p.title || p.slug)}</a>
                    <span style="color:#656d76;margin-left:0.5rem;font-size:0.85rem;">/${esc(user.username)}/${esc(p.slug)}</span>
                  </div>
                  <button class="delete-page" data-id="${p.id}" style="padding:0.3rem 0.6rem;background:#2d1214;border:1px solid #5a1d22;color:#f85149;border-radius:4px;cursor:pointer;font-size:0.8rem;">Delete</button>
                </div>
              `
                )
                .join("")
        }
      </div>
    </section>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">API Tokens</h2>
      <div id="tokens-list">
        ${tokens
          .map(
            (t: Token) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:0.5rem;">
              <div>
                <span style="font-weight:600;">${esc(t.name)}</span>
                <span style="color:#656d76;margin-left:0.5rem;font-size:0.85rem;">${esc(t.scopes.join(", "))}</span>
              </div>
              <button class="delete-token" data-id="${t.id}" style="padding:0.3rem 0.6rem;background:#2d1214;border:1px solid #5a1d22;color:#f85149;border-radius:4px;cursor:pointer;font-size:0.8rem;">Revoke</button>
            </div>
          `
          )
          .join("")}
      </div>
      <button id="create-token-btn" style="margin-top:0.5rem;padding:0.5rem 1rem;background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:6px;cursor:pointer;">+ New Token</button>
      <div id="new-token-display" style="display:none;margin-top:1rem;padding:1rem;background:#0f1a10;border:1px solid #1b3a20;border-radius:8px;">
        <p style="color:#3fb950;margin-bottom:0.5rem;">Token created! Copy it now — it won't be shown again:</p>
        <code id="new-token-value" style="display:block;padding:0.5rem;background:#0d1117;border-radius:4px;word-break:break-all;color:#3fb950;"></code>
      </div>
    </section>
  `;

  // SSE for real-time agent status (cookie-based auth, no token in URL)
  activeSSE = new EventSource("/api/agents/stream");
  const evtSource = activeSSE;
  evtSource.onmessage = (event) => {
    try {
      const agents: Agent[] = JSON.parse(event.data);
      renderAgentsList(agents, container);
    } catch { /* ignore parse errors */ }
  };
  evtSource.onerror = () => {
    // On error, close and fall back to static list
    evtSource.close();
    activeSSE = null;
    // Load once as fallback
    import("../lib/api").then(({ listAgents }) => {
      listAgents().then((agents) => renderAgentsList(agents || [], container));
    });
  };

  // Close SSE when navigating away
  const cleanup = () => {
    evtSource.close();
    activeSSE = null;
    window.removeEventListener("hashchange", cleanup);
  };
  window.addEventListener("hashchange", cleanup);

  // Event handlers
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    evtSource.close();
    activeSSE = null;
    await fetch("/api/logout", { method: "POST" });
    clearToken();
    window.location.hash = "#/login";
    window.location.reload();
  });

  document.querySelectorAll(".delete-page").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      if (confirm("Delete this page?")) {
        await deletePage(id);
        renderDashboard(container);
      }
    });
  });

  document.querySelectorAll(".delete-token").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      if (confirm("Revoke this token?")) {
        await deleteToken(id);
        renderDashboard(container);
      }
    });
  });

  document
    .getElementById("create-token-btn")
    ?.addEventListener("click", async () => {
      const name = prompt("Token name:", "clawdbot") || "clawdbot";
      const resp = await createToken(name, [
        "publish:pages",
        "read:pages",
      ]);
      const display = document.getElementById("new-token-display")!;
      display.style.display = "block";
      document.getElementById("new-token-value")!.textContent = resp.token;
    });

  // Mode switching for pair form
  const pairMode = document.getElementById("pair-mode") as HTMLSelectElement;
  const pairEndpointInput = document.getElementById("pair-endpoint") as HTMLInputElement;
  const pairNameInput = document.getElementById("pair-name") as HTMLInputElement;
  const pairRelaySelect = document.getElementById("pair-relay-agent") as HTMLSelectElement;

  function updatePairMode() {
    const isRelay = pairMode.value === "relay";
    pairEndpointInput.style.display = isRelay ? "none" : "block";
    pairNameInput.style.display = isRelay ? "none" : "block";
    pairRelaySelect.style.display = isRelay ? "block" : "none";
  }
  pairMode.addEventListener("change", updatePairMode);
  updatePairMode();

  document.getElementById("pair-btn")?.addEventListener("click", async () => {
    const isRelay = pairMode.value === "relay";
    const code = (
      document.getElementById("pair-code") as HTMLInputElement
    ).value.trim();
    const status = document.getElementById("pair-status")!;

    if (!code) {
      status.style.display = "block";
      status.style.background = "#2d1214";
      status.style.border = "1px solid #5a1d22";
      status.style.color = "#f85149";
      status.textContent = "Pairing code is required.";
      return;
    }

    if (isRelay) {
      // Relay mode pairing — send through relay endpoint
      const agentId = pairRelaySelect.value;
      if (!agentId) {
        status.style.display = "block";
        status.style.background = "#2d1214";
        status.style.border = "1px solid #5a1d22";
        status.style.color = "#f85149";
        status.textContent = "Select a relay agent to pair with.";
        return;
      }

      status.style.display = "block";
      status.style.background = "#161b22";
      status.style.border = "1px solid #30363d";
      status.style.color = "#8b949e";
      status.textContent = "Pairing via relay...";

      try {
        const { publicKeyBytes } = await getOrCreateKeypair();
        const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);

        // Get X25519 keypair for E2E encryption
        const x25519kp = await getOrCreateX25519Keypair();
        const x25519PubB64 = base64RawUrlEncode(x25519kp.publicKeyBytes);

        const res = await fetch(`/api/relay/${agentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            method: "POST",
            path: "/api/pair",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pairing_code: code,
              user_public_key: pubKeyB64,
              user_x25519_public_key: x25519PubB64,
              username: user.username,
            }),
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: res.statusText }));
          status.style.background = "#2d1214";
          status.style.border = "1px solid #5a1d22";
          status.style.color = "#f85149";
          status.textContent = `Pairing failed: ${data.error || res.statusText}`;
          return;
        }

        // Store agent's X25519 public key for E2E encryption
        const pairResp = await res.json().catch(() => ({}));
        let fingerprint = "";
        if (pairResp.agent_x25519_public_key) {
          const agentX25519Bytes = base64RawUrlDecode(pairResp.agent_x25519_public_key);
          await storeAgentX25519Key(agentId, agentX25519Bytes);
          fingerprint = pairResp.agent_x25519_public_key.substring(0, 8);
        }

        status.style.background = "#0f1a10";
        status.style.border = "1px solid #1b3a20";
        status.style.color = "#3fb950";
        if (fingerprint) {
          status.innerHTML = "";
          status.appendChild(document.createTextNode("Paired successfully via relay! "));
          const fpSpan = document.createElement("span");
          fpSpan.style.cssText = "font-family:monospace;background:#161b22;padding:2px 6px;border-radius:3px;border:1px solid #30363d;color:#58a6ff";
          fpSpan.textContent = "E2E: " + fingerprint;
          fpSpan.title = "Verify this matches the fingerprint shown in your agent terminal";
          status.appendChild(fpSpan);
        } else {
          status.textContent = "Paired successfully via relay!";
        }
      } catch (err: unknown) {
        status.style.display = "block";
        status.style.background = "#2d1214";
        status.style.border = "1px solid #5a1d22";
        status.style.color = "#f85149";
        status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      // Direct mode pairing — same as before
      const endpoint = pairEndpointInput.value.trim().replace(/\/$/, "");
      const name = pairNameInput.value.trim() || new URL(endpoint || "http://unknown").hostname;

      if (!endpoint) {
        status.style.display = "block";
        status.style.background = "#2d1214";
        status.style.border = "1px solid #5a1d22";
        status.style.color = "#f85149";
        status.textContent = "Endpoint URL is required for direct mode.";
        return;
      }

      status.style.display = "block";
      status.style.background = "#161b22";
      status.style.border = "1px solid #30363d";
      status.style.color = "#8b949e";
      status.textContent = "Generating keypair and pairing...";

      try {
        const { publicKeyBytes } = await getOrCreateKeypair();
        const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);

        // Get X25519 keypair for E2E encryption
        const x25519kp = await getOrCreateX25519Keypair();
        const x25519PubB64 = base64RawUrlEncode(x25519kp.publicKeyBytes);

        const res = await fetch(`${endpoint}/api/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairing_code: code,
            user_public_key: pubKeyB64,
            user_x25519_public_key: x25519PubB64,
            username: user.username,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          status.style.background = "#2d1214";
          status.style.border = "1px solid #5a1d22";
          status.style.color = "#f85149";
          status.textContent = `Pairing failed: ${data.error || res.statusText}`;
          return;
        }

        // Store agent's X25519 key if provided
        let directFingerprint = "";
        if (data.agent_x25519_public_key) {
          directFingerprint = data.agent_x25519_public_key.substring(0, 8);
        }

        status.textContent = "Registering agent on server...";
        try {
          await registerAgent(endpoint, name);
        } catch (regErr: unknown) {
          status.style.background = "#1a1700";
          status.style.border = "1px solid #3d3517";
          status.style.color = "#d29922";
          status.textContent = `Paired, but server registration failed: ${regErr instanceof Error ? regErr.message : String(regErr)}. Heartbeat won't work.`;
          return;
        }

        status.style.background = "#0f1a10";
        status.style.border = "1px solid #1b3a20";
        status.style.color = "#3fb950";
        if (directFingerprint) {
          status.innerHTML = "";
          status.appendChild(document.createTextNode("Paired and registered! "));
          const fpSpan = document.createElement("span");
          fpSpan.style.cssText = "font-family:monospace;background:#161b22;padding:2px 6px;border-radius:3px;border:1px solid #30363d;color:#58a6ff";
          fpSpan.textContent = "E2E: " + directFingerprint;
          fpSpan.title = "Verify this matches the fingerprint shown in your agent terminal";
          status.appendChild(fpSpan);
        } else {
          status.textContent = "Paired and registered successfully!";
        }
      } catch (err: unknown) {
        status.style.display = "block";
        status.style.background = "#2d1214";
        status.style.border = "1px solid #5a1d22";
        status.style.color = "#f85149";
        status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  });
}

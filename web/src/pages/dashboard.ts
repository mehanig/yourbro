import {
  API_BASE,
  getMe,
  listPagesViaRelay,
  listTokens,
  createToken,
  deleteToken,
  deleteAgent,
  logout,
  setLoggedIn,
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
} from "../lib/crypto";

/** Active SSE connection — closed before re-render to prevent leaks. */
let activeSSE: EventSource | null = null;

/** Cache: agentId → paired status. Reset on full re-render. */
const pairingCache = new Map<number, "checking" | "paired" | "unpaired">();

/** Escape HTML entities to prevent XSS when interpolating user-controlled data. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Create an RFC 9421 signature for a relay request. */
async function signRelayRequest(method: string, path: string): Promise<{ sigInput: string; sig: string }> {
  const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
  const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);
  const created = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const targetUri = `https://relay.internal${path}`;
  const sigParams = `("@method" "@target-uri");created=${created};nonce="${nonce}";keyid="${pubKeyB64}"`;
  const signatureBase = `"@method": ${method}\n"@target-uri": ${targetUri}\n"@signature-params": ${sigParams}`;
  const sigBytes = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(signatureBase));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return {
    sigInput: `sig1=${sigParams}`,
    sig: `sig1=:${sigB64}:`,
  };
}

/** Probe an agent via relay to check if this browser's Ed25519 key is authorized. */
async function probeAgentPairing(agentId: number): Promise<boolean> {
  try {
    const { sigInput, sig } = await signRelayRequest("GET", "/api/auth-check");
    const res = await fetch(`${API_BASE}/api/relay/${agentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        id: crypto.randomUUID(),
        method: "GET",
        path: "/api/auth-check",
        headers: {
          "Signature-Input": sigInput,
          "Signature": sig,
        },
      }),
    });
    if (!res.ok) return false;
    const envelope = await res.json();
    return envelope.status === 200;
  } catch {
    return false;
  }
}

function renderAgentsSplit(agents: Agent[], container: HTMLElement) {
  const pairedEl = container.querySelector("#paired-agents-list") as HTMLElement;
  const availableEl = container.querySelector("#available-agents-list") as HTMLElement;
  if (!pairedEl || !availableEl) return;

  const paired: Agent[] = [];
  const available: Agent[] = [];
  const checking: Agent[] = [];

  for (const a of agents) {
    const status = pairingCache.get(a.id);
    if (status === "paired") paired.push(a);
    else if (status === "unpaired") available.push(a);
    else if (a.is_online) checking.push(a);
    else paired.push(a); // offline agents with unknown status — show in paired (they were registered)
  }

  // Render paired agents
  if (paired.length === 0 && checking.length === 0) {
    pairedEl.innerHTML = '<p style="color:#656d76;">No paired agents yet.</p>';
  } else {
    pairedEl.innerHTML = [...paired, ...checking].map(a => {
      const isChecking = checking.includes(a);
      const statusDot = a.is_online
        ? `<span style="color:#3fb950;font-size:1.2rem;">●</span>`
        : `<span style="color:#656d76;font-size:1.2rem;">○</span>`;
      const checkingLabel = isChecking
        ? `<span style="color:#656d76;font-size:0.8rem;margin-left:0.5rem;">checking...</span>`
        : "";
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:0.5rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            ${statusDot}
            <span style="font-weight:600;">${esc(a.name || "unnamed")}</span>
            ${checkingLabel}
          </div>
          ${!isChecking ? `<button class="delete-agent" data-id="${a.id}" style="padding:0.3rem 0.6rem;background:#2d1214;border:1px solid #5a1d22;color:#f85149;border-radius:4px;cursor:pointer;font-size:0.8rem;">Remove</button>` : ""}
        </div>`;
    }).join("");
  }

  // Render available (unpaired) agents
  if (available.length === 0) {
    availableEl.innerHTML = '<p style="color:#656d76;">No unpaired agents online.</p>';
  } else {
    availableEl.innerHTML = available.map(a => `
      <div style="padding:0.75rem;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:0.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <span style="color:#e3b341;font-size:1.2rem;">●</span>
            <span style="font-weight:600;">${esc(a.name || "unnamed")}</span>
            <span style="color:#e3b341;font-size:0.8rem;">needs pairing</span>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <input class="pair-code-input" data-agent-id="${a.id}" type="text" placeholder="Pairing code" style="width:140px;padding:0.4rem;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;font-family:monospace;font-size:0.85rem;" />
          <button class="pair-agent-btn" data-agent-id="${a.id}" style="padding:0.4rem 0.8rem;background:#1a2e1d;border:1px solid #2a5a30;color:#3fb950;border-radius:6px;cursor:pointer;font-size:0.85rem;">Pair</button>
        </div>
        <div class="pair-agent-status" data-agent-id="${a.id}" style="margin-top:0.5rem;display:none;padding:0.5rem;border-radius:6px;font-size:0.85rem;"></div>
      </div>
    `).join("");
  }

  // Bind remove handlers for paired agents
  bindRemoveHandlers(container);
}

function bindRemoveHandlers(container: HTMLElement) {
  container.querySelectorAll(".delete-agent").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      if (!confirm("Remove this agent?")) return;

      try {
        const { sigInput, sig } = await signRelayRequest("DELETE", "/api/keys");
        const res = await fetch(`${API_BASE}/api/relay/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            id: crypto.randomUUID(),
            method: "DELETE",
            path: "/api/keys",
            headers: {
              "Signature-Input": sigInput,
              "Signature": sig,
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

      await deleteAgent(id);
      pairingCache.delete(id);
      renderDashboard(container);
    });
  });
}

/** Fetch and render pages from the first paired online agent via relay. */
async function renderPagesList(agents: Agent[], username: string, container: HTMLElement) {
  const pagesEl = container.querySelector("#pages-list");
  if (!pagesEl) return;

  // Find first online paired agent
  const onlineAgent = agents.find(a => a.is_online && pairingCache.get(a.id) === "paired");
  if (!onlineAgent) {
    const anyOnline = agents.some(a => a.is_online);
    pagesEl.innerHTML = anyOnline
      ? '<p style="color:#656d76;">Pair an agent to view pages.</p>'
      : '<p style="color:#656d76;">Agent offline — connect your agent to manage pages.</p>';
    return;
  }

  pagesEl.innerHTML = '<p style="color:#656d76;">Loading pages from agent...</p>';

  const pages = await listPagesViaRelay(onlineAgent.id);

  if (pages.length === 0) {
    pagesEl.innerHTML = '<p style="color:#656d76;">No pages yet. Use your AI agent to publish pages.</p>';
    return;
  }

  pagesEl.innerHTML = pages.map((p: Page) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:0.5rem;">
      <div>
        <a href="/p/${esc(username)}/${esc(p.slug)}" target="_blank" style="color:#58a6ff;text-decoration:none;font-weight:600;">${esc(p.title || p.slug)}</a>
        <span style="color:#656d76;margin-left:0.5rem;font-size:0.85rem;">/${esc(username)}/${esc(p.slug)}</span>
      </div>
      <button class="delete-page" data-slug="${esc(p.slug)}" data-agent-id="${onlineAgent.id}" style="padding:0.3rem 0.6rem;background:#2d1214;border:1px solid #5a1d22;color:#f85149;border-radius:4px;cursor:pointer;font-size:0.8rem;">Delete</button>
    </div>
  `).join("");

  // Bind delete handlers
  pagesEl.querySelectorAll(".delete-page").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const slug = (btn as HTMLElement).dataset.slug!;
      const agentId = (btn as HTMLElement).dataset.agentId!;
      if (!confirm(`Delete page "${slug}"?`)) return;

      try {
        const targetUri = `https://relay.internal/api/page/${encodeURIComponent(slug)}`;
        const { privateKey, publicKeyBytes } = await getOrCreateKeypair();
        const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);
        const created = Math.floor(Date.now() / 1000);
        const nonce = crypto.randomUUID();
        const sigParams = `("@method" "@target-uri");created=${created};nonce="${nonce}";keyid="${pubKeyB64}"`;
        const signatureBase = `"@method": DELETE\n"@target-uri": ${targetUri}\n"@signature-params": ${sigParams}`;
        const sig = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(signatureBase));
        const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

        const res = await fetch(`${API_BASE}/api/relay/${agentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            id: crypto.randomUUID(),
            method: "DELETE",
            path: `/api/page/${encodeURIComponent(slug)}`,
            headers: {
              "Signature-Input": `sig1=${sigParams}`,
              "Signature": `sig1=:${sigB64}:`,
            },
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: res.statusText }));
          alert(`Delete failed: ${data.error || res.statusText}`);
          return;
        }
        renderPagesList(agents, username, container);
      } catch (err) {
        alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });
}

/** Bind pairing button handlers for available (unpaired) agents. */
function bindPairHandlers(agents: Agent[], user: User, container: HTMLElement) {
  container.querySelectorAll(".pair-agent-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const agentId = (btn as HTMLElement).dataset.agentId!;
      const input = container.querySelector(`.pair-code-input[data-agent-id="${agentId}"]`) as HTMLInputElement;
      const statusEl = container.querySelector(`.pair-agent-status[data-agent-id="${agentId}"]`) as HTMLElement;
      const code = input?.value.trim();

      if (!code) {
        statusEl.style.display = "block";
        statusEl.style.background = "#2d1214";
        statusEl.style.border = "1px solid #5a1d22";
        statusEl.style.color = "#f85149";
        statusEl.textContent = "Pairing code is required.";
        return;
      }

      statusEl.style.display = "block";
      statusEl.style.background = "#161b22";
      statusEl.style.border = "1px solid #30363d";
      statusEl.style.color = "#8b949e";
      statusEl.textContent = "Pairing via relay...";

      try {
        const { publicKeyBytes } = await getOrCreateKeypair();
        const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);

        const x25519kp = await getOrCreateX25519Keypair();
        const x25519PubB64 = base64RawUrlEncode(x25519kp.publicKeyBytes);

        const res = await fetch(`${API_BASE}/api/relay/${agentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
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
          statusEl.style.background = "#2d1214";
          statusEl.style.border = "1px solid #5a1d22";
          statusEl.style.color = "#f85149";
          statusEl.textContent = `Pairing failed: ${data.error || res.statusText}`;
          return;
        }

        // Store agent's X25519 key
        const pairResp = await res.json().catch(() => ({}));
        if (pairResp.agent_x25519_public_key) {
          const agentX25519Bytes = base64RawUrlDecode(pairResp.agent_x25519_public_key);
          await storeAgentX25519Key(agentId, agentX25519Bytes);
        }

        // Update cache and re-render
        pairingCache.set(Number(agentId), "paired");
        renderAgentsSplit(agents, container);
        bindPairHandlers(agents, user, container);
        renderPagesList(agents, user.username, container);

      } catch (err: unknown) {
        statusEl.style.display = "block";
        statusEl.style.background = "#2d1214";
        statusEl.style.border = "1px solid #5a1d22";
        statusEl.style.color = "#f85149";
        statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    });
  });
}

export async function renderDashboard(container: HTMLElement) {
  if (activeSSE) {
    activeSSE.close();
    activeSSE = null;
  }
  pairingCache.clear();

  container.innerHTML = `<p style="color:#8b949e;">Loading...</p>`;

  let user: User;
  try {
    user = await getMe();
  } catch {
    setLoggedIn(false);
    window.location.hash = "#/";
    return;
  }

  // Check if browser has any Ed25519 keypair — if not, all agents are unpaired
  let hasKeypair = false;
  try {
    await getOrCreateKeypair();
    hasKeypair = true;
  } catch { /* no keypair */ }

  const tokens = (await listTokens()) || [];

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
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">Your Agents</h2>
      <div id="paired-agents-list">
        <p style="color:#656d76;">Connecting...</p>
      </div>
      <p style="color:#656d76;font-size:0.8rem;margin-top:0.5rem;">● online &nbsp; ○ offline</p>
    </section>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">Available Agents</h2>
      <p style="color:#8b949e;margin-bottom:0.75rem;font-size:0.9rem;">
        Online agents that need pairing with this browser. Enter the pairing code shown in your agent's terminal.
      </p>
      <div id="available-agents-list">
        <p style="color:#656d76;">Waiting for agents...</p>
      </div>
    </section>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">Pages</h2>
      <div id="pages-list">
        <p style="color:#656d76;">Waiting for agent connection...</p>
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

  // SSE for real-time agent status
  activeSSE = new EventSource(`${API_BASE}/api/agents/stream`, { withCredentials: true });
  const evtSource = activeSSE;
  let pagesLoaded = false;

  evtSource.onmessage = (event) => {
    try {
      const agents: Agent[] = JSON.parse(event.data);

      // Render with current pairing cache
      renderAgentsSplit(agents, container);
      bindPairHandlers(agents, user, container);

      // Probe online agents with unknown pairing status
      if (hasKeypair) {
        const toProbe = agents.filter(a => a.is_online && !pairingCache.has(a.id));
        for (const a of toProbe) {
          pairingCache.set(a.id, "checking");
          probeAgentPairing(a.id).then((isPaired) => {
            pairingCache.set(a.id, isPaired ? "paired" : "unpaired");
            renderAgentsSplit(agents, container);
            bindPairHandlers(agents, user, container);
            // Load pages once we find a paired agent
            if (isPaired && !pagesLoaded) {
              pagesLoaded = true;
              renderPagesList(agents, user.username, container);
            }
          });
        }
      } else {
        // No keypair — all online agents are unpaired
        for (const a of agents.filter(a => a.is_online)) {
          pairingCache.set(a.id, "unpaired");
        }
        renderAgentsSplit(agents, container);
        bindPairHandlers(agents, user, container);
      }

      // Pages from first paired agent
      if (!pagesLoaded && agents.some(a => a.is_online && pairingCache.get(a.id) === "paired")) {
        pagesLoaded = true;
        renderPagesList(agents, user.username, container);
      }
    } catch { /* ignore parse errors */ }
  };

  evtSource.onerror = () => {
    evtSource.close();
    activeSSE = null;
    import("../lib/api").then(({ listAgents }) => {
      listAgents().then((agents: Agent[]) => {
        renderAgentsSplit(agents || [], container);
        bindPairHandlers(agents || [], user, container);
        renderPagesList(agents || [], user.username, container);
      });
    });
  };

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
    await logout();
    window.location.hash = "#/";
    window.location.reload();
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
        "manage:keys",
      ]);
      const display = document.getElementById("new-token-display")!;
      display.style.display = "block";
      document.getElementById("new-token-value")!.textContent = resp.token;
    });
}

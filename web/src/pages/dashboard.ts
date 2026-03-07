import {
  API_BASE,
  getMe,
  listPagesViaRelay,
  getPageAnalytics,
  getPageDetailedAnalytics,
  listTokens,
  createToken,
  deleteToken,
  deleteAgent,
  logout,
  setLoggedIn,
  type User,
  type Page,
  type PageAnalytics,
  type PageDetailedAnalytics,
  type Token,
  type Agent,
} from "../lib/api";
import {
  getOrCreateX25519Keypair,
  storeAgentX25519Key,
  loadAgentX25519Key,
  base64RawUrlEncode,
  base64RawUrlDecode,
} from "../lib/crypto";
import {
  deriveE2EKey,
  encryptedRelay,
  x25519KeyId,
} from "../lib/e2e";

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

/** Probe an agent via E2E encrypted relay to check pairing status. */
async function probeAgentPairing(agentId: number): Promise<boolean> {
  try {
    // Check if we have the agent's X25519 key in IndexedDB
    const agentPubBytes = await loadAgentX25519Key(String(agentId));
    if (!agentPubBytes) return false;

    const x25519kp = await getOrCreateX25519Keypair();
    const aesKey = await deriveE2EKey(x25519kp.privateKey, agentPubBytes);
    const userKeyID = x25519KeyId(x25519kp.publicKeyBytes);

    const resp = await encryptedRelay(agentId, aesKey, userKeyID, {
      method: "POST",
      path: "/api/auth-check",
    });

    return resp !== null && resp.status === 200;
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
        ? `<span style="color:#3fb950;font-size:0.7rem;">●</span>`
        : `<span style="color:#656d76;font-size:0.7rem;">○</span>`;
      const checkingLabel = isChecking
        ? `<span style="color:#656d76;font-size:0.8rem;">checking...</span>`
        : "";
      return `
        <div class="yb-dash-item">
          <div style="display:flex;align-items:center;gap:0.6rem;">
            ${statusDot}
            <span style="font-weight:600;">${esc(a.name || "unnamed")}</span>
            ${checkingLabel}
          </div>
          ${!isChecking ? `<button class="delete-agent yb-btn-danger" data-id="${a.id}">Remove</button>` : ""}
        </div>`;
    }).join("");
  }

  // Render available (unpaired) agents
  if (available.length === 0) {
    availableEl.innerHTML = '<p style="color:#656d76;">No unpaired agents online.</p>';
  } else {
    availableEl.innerHTML = available.map(a => `
      <div style="padding:0.65rem 0;border-bottom:1px solid #21262d;">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;">
          <span style="color:#e3b341;font-size:0.7rem;">●</span>
          <span style="font-weight:600;">${esc(a.name || "unnamed")}</span>
          <span style="color:#e3b341;font-size:0.75rem;background:#2d2200;padding:0.1rem 0.4rem;border-radius:4px;">needs pairing</span>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <input class="pair-code-input" data-agent-id="${a.id}" type="text" placeholder="Pairing code" style="width:140px;padding:0.4rem 0.5rem;background:#0d1117;border:1px solid #21262d;color:#e6edf3;border-radius:6px;font-family:monospace;font-size:0.85rem;" />
          <button class="pair-agent-btn" style="padding:0.4rem 0.8rem;background:#1a2e1d;border:none;color:#3fb950;border-radius:6px;cursor:pointer;font-size:0.85rem;transition:background 0.15s;" data-agent-id="${a.id}">Pair</button>
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
        // Try to revoke via E2E encrypted relay
        const agentPubBytes = await loadAgentX25519Key(String(id));
        if (agentPubBytes) {
          const x25519kp = await getOrCreateX25519Keypair();
          const aesKey = await deriveE2EKey(x25519kp.privateKey, agentPubBytes);
          const userKeyID = x25519KeyId(x25519kp.publicKeyBytes);

          await encryptedRelay(id, aesKey, userKeyID, {
            method: "POST",
            path: "/api/revoke-key",
          });
        }
      } catch (err) {
        // Best-effort — continue to remove from server even if relay fails
        console.warn("Relay revocation failed:", err);
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

  const [pages, analyticsData] = await Promise.all([
    listPagesViaRelay(onlineAgent.id),
    getPageAnalytics().catch(() => [] as PageAnalytics[]),
  ]);

  if (pages.length === 0) {
    pagesEl.innerHTML = '<p style="color:#656d76;">No pages yet. Use your AI agent to publish pages.</p>';
    return;
  }

  // Build lookup map: slug -> analytics
  const analyticsMap = new Map<string, PageAnalytics>();
  for (const a of analyticsData) {
    analyticsMap.set(a.slug, a);
  }

  pagesEl.innerHTML = pages.map((p: Page) => {
    const stats = p.public ? analyticsMap.get(p.slug) : null;
    let statsHtml = '';
    if (p.public && (!stats || stats.total_views === 0)) {
      statsHtml = `<div class="yb-page-stats" data-slug="${esc(p.slug)}" style="color:#656d76;font-size:0.75rem;margin-top:0.2rem;cursor:pointer;" title="Click for detailed analytics">0 views</div>`;
    } else if (stats && stats.total_views > 0) {
      const parts = [`${stats.total_views} view${stats.total_views !== 1 ? 's' : ''}`];
      if (stats.unique_visitors_30d > 0) {
        parts.push(`${stats.unique_visitors_30d} unique`);
      }
      if (stats.top_referrers && stats.top_referrers.length > 0) {
        // Show top referrer domain only
        try {
          const refUrl = new URL(stats.top_referrers[0].source);
          parts.push(`via ${refUrl.hostname}`);
        } catch {
          parts.push(`via ${stats.top_referrers[0].source}`);
        }
      }
      statsHtml = `<div class="yb-page-stats" data-slug="${esc(p.slug)}" style="color:#656d76;font-size:0.75rem;margin-top:0.2rem;cursor:pointer;" title="Click for detailed analytics">${parts.join(' \u00b7 ')}</div>`;
    }
    return `
    <div class="yb-dash-item" style="flex-direction:column;align-items:stretch;gap:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <a href="/p/${esc(username)}/${esc(p.slug)}" target="_blank" style="color:#58a6ff;text-decoration:none;font-weight:600;">${esc(p.title || p.slug)}</a>
          ${p.public ? '<span style="color:#3fb950;font-size:0.75rem;background:#1a2e1d;padding:0.1rem 0.4rem;border-radius:4px;margin-left:0.4rem;">public</span>' : ''}
          <span style="color:#656d76;margin-left:0.5rem;font-size:0.8rem;">/${esc(username)}/${esc(p.slug)}</span>
        </div>
        <button class="delete-page yb-btn-danger" data-slug="${esc(p.slug)}" data-agent-id="${onlineAgent.id}">Delete</button>
      </div>
      ${statsHtml}
    </div>`;
  }).join("");

  // Bind analytics modal handlers
  pagesEl.querySelectorAll(".yb-page-stats").forEach((el) => {
    el.addEventListener("click", () => {
      const slug = (el as HTMLElement).dataset.slug;
      if (slug) openAnalyticsModal(slug);
    });
  });

  // Bind delete handlers
  pagesEl.querySelectorAll(".delete-page").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const slug = (btn as HTMLElement).dataset.slug!;
      const agentId = Number((btn as HTMLElement).dataset.agentId!);
      if (!confirm(`Delete page "${slug}"?`)) return;

      try {
        const agentPubBytes = await loadAgentX25519Key(String(agentId));
        if (!agentPubBytes) {
          alert("Cannot delete: agent encryption keys missing. Re-pair your agent.");
          return;
        }
        const x25519kp = await getOrCreateX25519Keypair();
        const aesKey = await deriveE2EKey(x25519kp.privateKey, agentPubBytes);
        const userKeyID = x25519KeyId(x25519kp.publicKeyBytes);

        const resp = await encryptedRelay(agentId, aesKey, userKeyID, {
          method: "DELETE",
          path: `/api/page/${encodeURIComponent(slug)}`,
        });

        if (!resp || resp.status < 200 || resp.status >= 300) {
          alert(`Delete failed: ${resp?.body || "unknown error"}`);
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

        // Store agent's X25519 key (relay wraps agent response in envelope with body as string)
        const relayResp = await res.json();
        const pairResp = relayResp.body ? JSON.parse(relayResp.body) : relayResp;
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

/** Open analytics modal for a page slug. */
async function openAnalyticsModal(slug: string) {
  // Remove existing modal if any
  document.getElementById("yb-analytics-modal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "yb-analytics-modal";
  document.body.appendChild(overlay);

  // Use a <style> tag for robust styling (inline styles can conflict with page CSS)
  overlay.innerHTML = `
    <style>
      #yb-analytics-modal {
        position: fixed !important;
        top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
        background: rgba(0,0,0,0.75) !important;
        z-index: 9999 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 1rem !important;
      }
      .yb-modal-card {
        background: #161b22 !important;
        border: 1px solid #30363d !important;
        border-radius: 12px !important;
        max-width: 520px !important;
        width: 100% !important;
        max-height: 85vh !important;
        overflow-y: auto !important;
        padding: 1.5rem !important;
        box-shadow: 0 16px 48px rgba(0,0,0,0.5) !important;
        color: #e6edf3 !important;
        font-family: system-ui, -apple-system, sans-serif !important;
      }
      .yb-modal-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-bottom: 1.25rem !important;
      }
      .yb-modal-header h2 {
        margin: 0 !important;
        font-size: 1.05rem !important;
        font-weight: 700 !important;
        color: #e6edf3 !important;
      }
      .yb-modal-close {
        background: none !important;
        border: none !important;
        color: #656d76 !important;
        font-size: 1.5rem !important;
        cursor: pointer !important;
        padding: 0.2rem 0.5rem !important;
        line-height: 1 !important;
      }
      .yb-modal-close:hover { color: #e6edf3 !important; }
      .yb-modal-stats {
        display: flex !important;
        gap: 1.5rem !important;
        margin-bottom: 1.5rem !important;
        flex-wrap: wrap !important;
      }
      .yb-modal-stat-label { color: #656d76 !important; font-size: 0.8rem !important; margin-bottom: 0.15rem !important; }
      .yb-modal-stat-value { font-size: 1.4rem !important; font-weight: 700 !important; color: #e6edf3 !important; }
      .yb-modal-stat-value-sm { font-size: 0.95rem !important; font-weight: 600 !important; color: #8b949e !important; margin-top: 0.25rem !important; }
      .yb-modal-section-title {
        font-size: 0.9rem !important;
        font-weight: 600 !important;
        color: #e6edf3 !important;
        margin: 1.25rem 0 0.6rem !important;
        padding-bottom: 0.4rem !important;
        border-bottom: 1px solid #21262d !important;
      }
      .yb-modal-bar-row {
        display: flex !important;
        align-items: center !important;
        gap: 0.5rem !important;
        margin-bottom: 0.35rem !important;
      }
      .yb-modal-bar-date { color: #8b949e !important; font-size: 0.8rem !important; min-width: 48px !important; text-align: right !important; flex-shrink: 0 !important; }
      .yb-modal-bar { background: #1f6feb !important; height: 18px !important; border-radius: 3px !important; min-width: 3px !important; flex-shrink: 0 !important; }
      .yb-modal-bar-count { color: #e6edf3 !important; font-size: 0.8rem !important; flex-shrink: 0 !important; }
      .yb-modal-bar-unique { color: #656d76 !important; font-size: 0.75rem !important; flex-shrink: 0 !important; }
      .yb-modal-ref-row {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 0.4rem 0 !important;
        border-bottom: 1px solid #21262d !important;
      }
      .yb-modal-ref-row:last-child { border-bottom: none !important; }
      .yb-modal-ref-source { color: #e6edf3 !important; font-size: 0.85rem !important; }
      .yb-modal-ref-count { color: #8b949e !important; font-size: 0.85rem !important; }
      .yb-modal-ref-pct { color: #656d76 !important; }
      .yb-modal-empty { color: #656d76 !important; font-size: 0.85rem !important; }
      @media (max-width: 560px) {
        .yb-modal-card { padding: 1rem !important; margin: 0.5rem !important; }
        .yb-modal-stats { gap: 1rem !important; }
        .yb-modal-stat-value { font-size: 1.2rem !important; }
        .yb-modal-bar { max-width: 120px !important; }
      }
    </style>
    <div class="yb-modal-card">
      <div class="yb-modal-header">
        <h2>Analytics: ${esc(slug)}</h2>
        <button class="yb-modal-close">&times;</button>
      </div>
      <p class="yb-modal-empty">Loading analytics...</p>
    </div>`;

  // Close handlers
  const close = () => overlay.remove();
  overlay.querySelector(".yb-modal-close")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
  });

  try {
    const data: PageDetailedAnalytics = await getPageDetailedAnalytics(slug);
    const card = overlay.querySelector(".yb-modal-card") as HTMLElement;
    if (!card) return;

    // Summary stats
    let lastViewed = "Never";
    if (data.last_viewed_at) {
      const d = new Date(data.last_viewed_at);
      const diff = Date.now() - d.getTime();
      if (diff < 3600000) lastViewed = `${Math.floor(diff / 60000)}m ago`;
      else if (diff < 86400000) lastViewed = `${Math.floor(diff / 3600000)}h ago`;
      else lastViewed = d.toLocaleDateString();
    }

    // Build daily views bar chart
    let dailyHtml = '<p class="yb-modal-empty">No daily data yet.</p>';
    if (data.daily_views && data.daily_views.length > 0) {
      const maxViews = Math.max(...data.daily_views.map(d => d.views));
      dailyHtml = data.daily_views.slice(0, 14).map(dv => {
        const barPct = maxViews > 0 ? Math.max(1, Math.round((dv.views / maxViews) * 100)) : 1;
        const dateLabel = new Date(dv.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return `
          <div class="yb-modal-bar-row">
            <span class="yb-modal-bar-date">${dateLabel}</span>
            <div class="yb-modal-bar" style="width:${barPct}%"></div>
            <span class="yb-modal-bar-count">${dv.views}</span>
            <span class="yb-modal-bar-unique">(${dv.unique_views} uniq)</span>
          </div>`;
      }).join("");
    }

    // Build referrers table
    let refsHtml = '<p class="yb-modal-empty">No referrer data yet.</p>';
    if (data.top_referrers && data.top_referrers.length > 0) {
      const totalRefViews = data.top_referrers.reduce((sum, r) => sum + r.count, 0);
      refsHtml = data.top_referrers.map(r => {
        let label = r.source || "(direct)";
        try { label = new URL(r.source).hostname; } catch { /* use raw */ }
        const pct = totalRefViews > 0 ? Math.round((r.count / totalRefViews) * 100) : 0;
        return `
          <div class="yb-modal-ref-row">
            <span class="yb-modal-ref-source">${esc(label)}</span>
            <span class="yb-modal-ref-count">${r.count} <span class="yb-modal-ref-pct">(${pct}%)</span></span>
          </div>`;
      }).join("");
    }

    card.innerHTML = `
      <div class="yb-modal-header">
        <h2>Analytics: ${esc(slug)}</h2>
        <button class="yb-modal-close">&times;</button>
      </div>
      <div class="yb-modal-stats">
        <div>
          <div class="yb-modal-stat-label">Total views</div>
          <div class="yb-modal-stat-value">${data.total_views}</div>
        </div>
        <div>
          <div class="yb-modal-stat-label">Unique (30d)</div>
          <div class="yb-modal-stat-value">${data.unique_visitors_30d}</div>
        </div>
        <div>
          <div class="yb-modal-stat-label">Last viewed</div>
          <div class="yb-modal-stat-value-sm">${lastViewed}</div>
        </div>
      </div>
      <div class="yb-modal-section-title">Views (last 14 days)</div>
      ${dailyHtml}
      <div class="yb-modal-section-title">Top Referrers</div>
      ${refsHtml}
    `;

    card.querySelector(".yb-modal-close")!.addEventListener("click", close);
  } catch (err) {
    const p = overlay.querySelector(".yb-modal-empty");
    if (p) p.textContent = `Failed to load analytics: ${err instanceof Error ? err.message : String(err)}`;
  }
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

  // Check if browser has X25519 keypair — if not, all agents are unpaired
  let hasKeypair = false;
  try {
    await getOrCreateX25519Keypair();
    hasKeypair = true;
  } catch { /* no keypair */ }

  const tokens = (await listTokens()) || [];

  container.innerHTML = `
    <style>
      .yb-dash-section{background:#161b22;border-radius:12px;padding:1.5rem 1.75rem;margin-bottom:1.25rem;}
      .yb-dash-section h2{font-size:1.1rem;font-weight:700;margin:0 0 1rem;display:flex;align-items:center;gap:0.5rem;}
      .yb-dash-section h2 .yb-icon{font-size:1.2rem;opacity:0.7;}
      .yb-dash-item{display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0;border-bottom:1px solid #21262d;}
      .yb-dash-item:last-child{border-bottom:none;}
      .yb-btn-danger{padding:0.3rem 0.7rem;background:transparent;border:1px solid #5a1d22;color:#f85149;border-radius:6px;cursor:pointer;font-size:0.8rem;transition:background 0.15s;}
      .yb-btn-danger:hover{background:#2d1214;}
      .yb-btn-secondary{padding:0.45rem 1rem;background:#21262d;border:none;color:#e6edf3;border-radius:6px;cursor:pointer;font-size:0.85rem;transition:background 0.15s;}
      .yb-btn-secondary:hover{background:#30363d;}
      @media(max-width:700px){
        .yb-dash-grid{grid-template-columns:1fr !important;}
        .yb-dash-header{flex-direction:column;gap:1rem !important;align-items:flex-start !important;}
      }
    </style>
    <div style="max-width:1060px;margin:0 auto;padding:2rem 1.5rem;">

    <!-- Header -->
    <header class="yb-dash-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;">
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <a href="#/" style="display:flex;align-items:center;gap:0.75rem;text-decoration:none;color:#e6edf3;">
          <img src="/yourbro_logo.png" alt="" style="width:36px;height:auto;" />
          <h1 style="font-size:1.5rem;font-weight:700;margin:0;">yourbro</h1>
        </a>
      </div>
      <div style="display:flex;align-items:center;gap:1rem;">
        <span style="color:#656d76;font-size:0.9rem;">${esc(user.email)}</span>
        <a href="#/how-to-use" style="color:#58a6ff;text-decoration:none;font-size:0.9rem;">How to Use</a>
        <button id="logout-btn" class="yb-btn-secondary">Logout</button>
      </div>
    </header>

    <!-- Pages (full width) -->
    <div class="yb-dash-section">
      <h2><span class="yb-icon">◧</span> Pages</h2>
      <div id="pages-list">
        <p style="color:#656d76;margin:0;">Waiting for agent connection...</p>
      </div>
    </div>

    <!-- Agents (two columns) -->
    <div class="yb-dash-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;align-items:start;">
      <div class="yb-dash-section">
        <h2><span class="yb-icon">●</span> Paired Agents</h2>
        <div id="paired-agents-list">
          <p style="color:#656d76;margin:0;">Connecting...</p>
        </div>
      </div>

      <div class="yb-dash-section">
        <h2><span class="yb-icon" style="color:#e3b341;">◐</span> Available Agents</h2>
        <p style="color:#656d76;font-size:0.85rem;margin:-0.5rem 0 1rem;line-height:1.5;">
          Online agents that need pairing. Enter the code from your agent's terminal.
        </p>
        <div id="available-agents-list">
          <p style="color:#656d76;margin:0;">Waiting for agents...</p>
        </div>
      </div>
    </div>

    <!-- API Tokens (full width) -->
    <div class="yb-dash-section">
      <h2><span class="yb-icon">⚿</span> API Tokens</h2>
      <div id="tokens-list">
        ${tokens
          .map(
            (t: Token) => `
            <div class="yb-dash-item">
              <div>
                <span style="font-weight:600;">${esc(t.name)}</span>
                <span style="color:#656d76;margin-left:0.5rem;font-size:0.8rem;">${esc(t.scopes.join(", "))}</span>
              </div>
              <button class="delete-token yb-btn-danger" data-id="${t.id}">Revoke</button>
            </div>
          `
          )
          .join("")}
      </div>
      <button id="create-token-btn" class="yb-btn-secondary" style="margin-top:0.75rem;">+ New Token</button>
      <div id="new-token-display" style="display:none;margin-top:1rem;padding:1rem;background:#0f1a10;border-radius:8px;">
        <p style="color:#3fb950;margin-bottom:0.5rem;font-size:0.9rem;">Token created! Copy it now — it won't be shown again:</p>
        <code id="new-token-value" style="display:block;padding:0.5rem;background:#0d1117;border-radius:4px;word-break:break-all;color:#3fb950;font-size:0.85rem;"></code>
      </div>
    </div>
    </div>
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

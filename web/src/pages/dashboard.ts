import {
  getMe,
  listPages,
  listTokens,
  createToken,
  deleteToken,
  deletePage,
  clearToken,
  type User,
  type Page,
  type Token,
} from "../lib/api";
import { getOrCreateKeypair, base64RawUrlEncode } from "../lib/crypto";

export async function renderDashboard(container: HTMLElement) {
  container.innerHTML = `<p style="color:#888;">Loading...</p>`;

  let user: User;
  try {
    user = await getMe();
  } catch {
    clearToken();
    window.location.hash = "#/login";
    return;
  }

  const [pages, tokens] = await Promise.all([listPages(), listTokens()]).then(
    ([p, t]) => [p || [], t || []] as [Page[], Token[]]
  );

  container.innerHTML = `
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid #222;">
      <h1 style="font-size:1.5rem;font-weight:700;">yourbro</h1>
      <div style="display:flex;align-items:center;gap:1rem;">
        <span style="color:#888;">${user.email}</span>
        <button id="logout-btn" style="padding:0.4rem 0.8rem;background:#222;border:1px solid #333;color:#fafafa;border-radius:6px;cursor:pointer;">Logout</button>
      </div>
    </header>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">Pages</h2>
      <div id="pages-list">
        ${
          pages.length === 0
            ? '<p style="color:#666;">No pages yet. Use an API token with an AI agent to publish pages.</p>'
            : pages
                .map(
                  (p: Page) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#111;border:1px solid #222;border-radius:8px;margin-bottom:0.5rem;">
                  <div>
                    <a href="/p/${user.username}/${p.slug}" target="_blank" style="color:#60a5fa;text-decoration:none;font-weight:600;">${p.title || p.slug}</a>
                    <span style="color:#666;margin-left:0.5rem;font-size:0.85rem;">/${user.username}/${p.slug}</span>
                  </div>
                  <button class="delete-page" data-id="${p.id}" style="padding:0.3rem 0.6rem;background:#300;border:1px solid #500;color:#f88;border-radius:4px;cursor:pointer;font-size:0.8rem;">Delete</button>
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
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#111;border:1px solid #222;border-radius:8px;margin-bottom:0.5rem;">
              <div>
                <span style="font-weight:600;">${t.name}</span>
                <span style="color:#666;margin-left:0.5rem;font-size:0.85rem;">${t.scopes.join(", ")}</span>
              </div>
              <button class="delete-token" data-id="${t.id}" style="padding:0.3rem 0.6rem;background:#300;border:1px solid #500;color:#f88;border-radius:4px;cursor:pointer;font-size:0.8rem;">Revoke</button>
            </div>
          `
          )
          .join("")}
      </div>
      <button id="create-token-btn" style="margin-top:0.5rem;padding:0.5rem 1rem;background:#1a1a2e;border:1px solid #333;color:#fafafa;border-radius:6px;cursor:pointer;">+ New Token</button>
      <div id="new-token-display" style="display:none;margin-top:1rem;padding:1rem;background:#0a1a0a;border:1px solid #1a3a1a;border-radius:8px;">
        <p style="color:#4ade80;margin-bottom:0.5rem;">Token created! Copy it now — it won't be shown again:</p>
        <code id="new-token-value" style="display:block;padding:0.5rem;background:#000;border-radius:4px;word-break:break-all;color:#4ade80;"></code>
      </div>
    </section>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;margin-bottom:1rem;">Pair Agent</h2>
      <p style="color:#888;margin-bottom:1rem;font-size:0.9rem;">Connect your browser to an agent machine. Enter the agent endpoint URL and the pairing code shown in the agent's logs.</p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <input id="pair-endpoint" type="text" placeholder="http://localhost:9443" style="flex:1;min-width:200px;padding:0.5rem;background:#111;border:1px solid #333;color:#fafafa;border-radius:6px;" />
        <input id="pair-code" type="text" placeholder="Pairing code" style="width:140px;padding:0.5rem;background:#111;border:1px solid #333;color:#fafafa;border-radius:6px;font-family:monospace;" />
        <button id="pair-btn" style="padding:0.5rem 1rem;background:#1a2e1a;border:1px solid #2a4a2a;color:#4ade80;border-radius:6px;cursor:pointer;">Pair</button>
      </div>
      <div id="pair-status" style="margin-top:0.75rem;display:none;padding:0.75rem;border-radius:8px;font-size:0.9rem;"></div>
    </section>
  `;

  // Event handlers
  document.getElementById("logout-btn")?.addEventListener("click", () => {
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

  document.getElementById("pair-btn")?.addEventListener("click", async () => {
    const endpoint = (
      document.getElementById("pair-endpoint") as HTMLInputElement
    ).value.trim().replace(/\/$/, "");
    const code = (
      document.getElementById("pair-code") as HTMLInputElement
    ).value.trim();
    const status = document.getElementById("pair-status")!;

    if (!endpoint || !code) {
      status.style.display = "block";
      status.style.background = "#2a1a1a";
      status.style.border = "1px solid #4a2a2a";
      status.style.color = "#f88";
      status.textContent = "Both endpoint and pairing code are required.";
      return;
    }

    status.style.display = "block";
    status.style.background = "#1a1a2e";
    status.style.border = "1px solid #333";
    status.style.color = "#888";
    status.textContent = "Generating keypair and pairing...";

    try {
      const { publicKeyBytes } = await getOrCreateKeypair();
      const pubKeyB64 = base64RawUrlEncode(publicKeyBytes);

      const res = await fetch(`${endpoint}/api/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairing_code: code,
          user_public_key: pubKeyB64,
          username: user.username,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        status.style.background = "#0a1a0a";
        status.style.border = "1px solid #1a3a1a";
        status.style.color = "#4ade80";
        status.textContent =
          "Paired successfully! Your browser keypair is now authorized on the agent.";
      } else {
        status.style.background = "#2a1a1a";
        status.style.border = "1px solid #4a2a2a";
        status.style.color = "#f88";
        status.textContent = `Pairing failed: ${data.error || res.statusText}`;
      }
    } catch (err: unknown) {
      status.style.display = "block";
      status.style.background = "#2a1a1a";
      status.style.border = "1px solid #4a2a2a";
      status.style.color = "#f88";
      status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
}

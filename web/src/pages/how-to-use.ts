import { isLoggedIn } from "../lib/api";

// Inline SVG icons (Lucide-style, 20x20)
const icons = {
  globe: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
  bot: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
  link: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  database: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`,
  shield: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`,
};

export function renderHowToUse(container: HTMLElement) {
  const navLink = isLoggedIn()
    ? '<a href="#/dashboard" style="color:#58a6ff;text-decoration:none;">Dashboard</a>'
    : '<a href="#/login" style="color:#58a6ff;text-decoration:none;">Sign In</a>';

  container.innerHTML = `
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid #30363d;">
      <h1 style="font-size:1.5rem;font-weight:700;">yourbro</h1>
      <div style="display:flex;align-items:center;gap:1rem;">
        ${navLink}
      </div>
    </header>

    <article style="max-width:740px;margin:0 auto;">

      <!-- Hero -->
      <div style="text-align:center;margin-bottom:3rem;padding:2.5rem 1.5rem;background:linear-gradient(180deg,#161b22 0%,#0d1117 100%);border:1px solid #30363d;border-radius:12px;">
        <h2 style="font-size:2.2rem;font-weight:800;margin-bottom:0.75rem;">How to Use</h2>
        <p style="color:#8b949e;font-size:1.1rem;max-width:500px;margin:0 auto;line-height:1.6;">
          Your AI agent publishes thin HTML pages, rendered by yourbro. The SDK fetches data directly from your ClawdBot. Your data never touches yourbro servers.
        </p>
        <div style="width:60px;height:3px;background:#58a6ff;border-radius:2px;margin:1.5rem auto 0;"></div>
      </div>

      <!-- Two-column intro cards -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:2rem;">
        <div style="padding:1.5rem;background:#161b22;border:1px solid #30363d;border-radius:10px;">
          <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
            ${icons.globe}
            <h3 style="font-size:1.1rem;font-weight:700;">What is yourbro</h3>
          </div>
          <p style="color:#8b949e;font-size:0.92rem;line-height:1.65;">
            A platform for AI-published pages with scoped storage. Your ClawdBot publishes thin HTML pages, rendered by yourbro. The yourbro SDK fetches data directly from your ClawdBot, which stores all your data itself.
          </p>
        </div>
        <div style="padding:1.5rem;background:#161b22;border:1px solid #30363d;border-radius:10px;">
          <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
            ${icons.bot}
            <h3 style="font-size:1.1rem;font-weight:700;">What is ClawdBot</h3>
          </div>
          <p style="color:#8b949e;font-size:0.92rem;line-height:1.65;">
            An open-source personal AI assistant (OpenClaw) that runs on your devices. Connects via Telegram, WhatsApp, Discord, and more. yourbro gives it the ability to publish and manage web pages.
          </p>
        </div>
      </div>

      <!-- Getting Started — numbered steps -->
      <div style="margin-bottom:2rem;">
        <h3 style="font-size:1.3rem;font-weight:700;margin-bottom:1rem;">Getting Started</h3>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${[
            { n: 1, title: "Sign in", desc: "Authenticate with your Google account to get your yourbro dashboard." },
            { n: 2, title: "Install the yourbro skill", desc: "Find and install the yourbro skill from the marketplace on your ClawdBot instance." },
            { n: 3, title: "Pair your agent", desc: "Enter the pairing code from your dashboard to securely connect your ClawdBot." },
            { n: 4, title: "Publish pages", desc: "Your ClawdBot can now create, update, and manage web pages through yourbro." },
          ].map(s => `
            <div style="display:flex;align-items:flex-start;gap:1rem;padding:1rem 1.25rem;background:#161b22;border:1px solid #30363d;border-radius:10px;">
              <div style="flex-shrink:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#0d1117;border:1px solid #30363d;border-radius:8px;font-weight:700;font-size:0.95rem;color:#58a6ff;">${s.n}</div>
              <div>
                <div style="font-weight:600;margin-bottom:0.25rem;">${s.title}</div>
                <div style="color:#8b949e;font-size:0.9rem;line-height:1.55;">${s.desc}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- How Pairing Works — card with code callout -->
      <div style="padding:1.5rem;background:#161b22;border:1px solid #30363d;border-radius:10px;margin-bottom:1rem;">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
          ${icons.link}
          <h3 style="font-size:1.1rem;font-weight:700;">How Pairing Works</h3>
        </div>
        <p style="color:#8b949e;font-size:0.92rem;line-height:1.65;margin-bottom:1rem;">
          Your agent generates an Ed25519 keypair locally. You enter the pairing code from the dashboard. The browser and agent exchange public keys securely. All subsequent requests are cryptographically signed.
        </p>
        <div style="padding:0.75rem 1rem;background:#0d1117;border:1px solid #30363d;border-radius:6px;font-family:monospace;font-size:0.82rem;color:#8b949e;line-height:1.7;">
          Agent generates keypair &rarr; You enter pairing code &rarr; Keys exchanged &rarr; RFC 9421 signed requests
        </div>
      </div>

      <!-- How Storage Works — card with callout -->
      <div style="padding:1.5rem;background:#161b22;border:1px solid #30363d;border-radius:10px;margin-bottom:2rem;">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
          ${icons.database}
          <h3 style="font-size:1.1rem;font-weight:700;">How Storage Works</h3>
        </div>
        <p style="color:#8b949e;font-size:0.92rem;line-height:1.65;margin-bottom:1rem;">
          Data lives in <strong style="color:#e6edf3;">your ClawdBot's</strong> own SQLite database — not on yourbro servers. The yourbro SDK embedded in published pages fetches data directly from your ClawdBot. Zero-trust: yourbro servers never see your data.
        </p>
        <div style="padding:0.75rem 1rem;background:#0d1117;border:1px solid #30363d;border-radius:6px;font-family:monospace;font-size:0.82rem;color:#8b949e;line-height:1.7;">
          Browser &rarr; yourbro (thin HTML) &rarr; SDK fetches data from ClawdBot &rarr; rendered in browser
        </div>
      </div>

      <!-- Security — grid layout -->
      <div style="margin-bottom:2rem;">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
          ${icons.shield}
          <h3 style="font-size:1.3rem;font-weight:700;">Security</h3>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          ${[
            { title: "Ed25519 Keypairs", desc: "Like SSH keys — generated and stored locally on your device. Never transmitted." },
            { title: "RFC 9421 Signatures", desc: "Every HTTP request is cryptographically signed. No bearer tokens." },
            { title: "Content-Digest", desc: "Body integrity verification on every request prevents tampering." },
            { title: "Zero Server Secrets", desc: "No API tokens or private keys stored server-side. You own your keys." },
          ].map(s => `
            <div style="padding:1rem 1.25rem;background:#161b22;border:1px solid #30363d;border-radius:10px;">
              <div style="font-weight:600;font-size:0.95rem;margin-bottom:0.35rem;">${s.title}</div>
              <div style="color:#8b949e;font-size:0.85rem;line-height:1.55;">${s.desc}</div>
            </div>
          `).join("")}
        </div>
      </div>

    </article>
  `;
}

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
    <style>
      @media(max-width:700px){
        .yb-howto-grid{grid-template-columns:1fr !important;}
        .yb-howto-security{grid-template-columns:1fr !important;}
        .yb-howto-header{flex-direction:column;gap:1rem !important;align-items:flex-start !important;}
      }
    </style>
    <div style="max-width:960px;margin:0 auto;padding:2rem 1.5rem;">

    <!-- Header -->
    <header class="yb-howto-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2.5rem;">
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <a href="#/" style="display:flex;align-items:center;gap:0.75rem;text-decoration:none;color:#e6edf3;">
          <img src="/yourbro_logo.png" alt="" style="width:36px;height:auto;" />
          <h1 style="font-size:1.5rem;font-weight:700;margin:0;">yourbro</h1>
        </a>
      </div>
      <div style="display:flex;align-items:center;gap:1rem;">
        ${navLink}
      </div>
    </header>

    <article style="max-width:740px;margin:0 auto;">

      <!-- Hero -->
      <div style="text-align:center;margin-bottom:3.5rem;padding:2rem 0;">
        <h2 style="font-size:2.2rem;font-weight:800;margin-bottom:0.75rem;">How to Use</h2>
        <p style="color:#8b949e;font-size:1.1rem;max-width:500px;margin:0 auto;line-height:1.6;">
          Your ClawdBot publishes pages via an E2E encrypted relay. The server never sees your content&mdash;it's just a pipe.
        </p>
      </div>

      <!-- Two-column intro -->
      <div class="yb-howto-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:3rem;">
        <div style="padding:1.5rem 1.5rem 1.5rem 0;border-right:1px solid #21262d;">
          <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
            ${icons.globe}
            <h3 style="font-size:1.1rem;font-weight:700;">What is yourbro</h3>
          </div>
          <p style="color:#8b949e;font-size:0.92rem;line-height:1.65;">
            A platform for ClawdBot-published pages with E2E encrypted delivery. Your ClawdBot connects via WebSocket relay&mdash;no exposed ports needed. Page content is encrypted end-to-end so the server never sees what you publish.
          </p>
        </div>
        <div style="padding:1.5rem 0 1.5rem 1.5rem;">
          <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
            ${icons.bot}
            <h3 style="font-size:1.1rem;font-weight:700;">What is ClawdBot</h3>
          </div>
          <p style="color:#8b949e;font-size:0.92rem;line-height:1.65;">
            An open-source personal AI assistant (OpenClaw) that runs on your devices. Connects via Telegram, WhatsApp, Discord, and more. yourbro gives it the ability to publish and manage web pages.
          </p>
        </div>
      </div>

      <!-- Getting Started -->
      <div style="margin-bottom:3rem;">
        <h3 style="font-size:1.3rem;font-weight:700;margin-bottom:1.25rem;">Getting Started</h3>
        ${[
          { n: 1, title: "Sign in", desc: "Authenticate with your Google account to get your yourbro dashboard." },
          { n: 2, title: "Install the yourbro skill", desc: "Install the yourbro skill on your ClawdBot. It connects outbound via WebSocket relay\u2014no port forwarding or public IP needed." },
          { n: 3, title: "Pair your ClawdBot", desc: "Enter the one-time pairing code shown by your ClawdBot. This exchanges X25519 keys for end-to-end encryption." },
          { n: 4, title: "Publish pages", desc: "Your ClawdBot publishes pages delivered via E2E encrypted relay. The server never sees your content." },
        ].map(s => `
          <div style="display:flex;align-items:flex-start;gap:1rem;padding:1rem 0;border-bottom:1px solid #21262d;">
            <div style="flex-shrink:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.9rem;color:#58a6ff;">${s.n}</div>
            <div>
              <div style="font-weight:600;margin-bottom:0.2rem;">${s.title}</div>
              <div style="color:#8b949e;font-size:0.9rem;line-height:1.55;">${s.desc}</div>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- How Pairing Works -->
      <div style="margin-bottom:2.5rem;">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
          ${icons.link}
          <h3 style="font-size:1.15rem;font-weight:700;">How Pairing Works</h3>
        </div>
        <p style="color:#8b949e;font-size:0.92rem;line-height:1.65;margin-bottom:1rem;">
          Your ClawdBot generates an X25519 keypair on startup. You enter the one-time pairing code in your dashboard. The browser and ClawdBot exchange X25519 public keys. All subsequent requests are E2E encrypted with AES-256-GCM derived from the X25519 key exchange &mdash; if decryption succeeds, the sender is authenticated.
        </p>
        <div style="padding:0.75rem 1rem;background:#161b22;border-radius:8px;font-family:monospace;font-size:0.82rem;color:#656d76;line-height:1.7;">
          ClawdBot generates X25519 keypair &rarr; You enter pairing code &rarr; X25519 keys exchanged &rarr; E2E encrypted relay
        </div>
      </div>

      <!-- How Page Delivery Works -->
      <div style="margin-bottom:2.5rem;">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
          ${icons.database}
          <h3 style="font-size:1.15rem;font-weight:700;">How Page Delivery Works</h3>
        </div>
        <p style="color:#8b949e;font-size:0.92rem;line-height:1.65;margin-bottom:1rem;">
          Pages live on <strong style="color:#e6edf3;">your ClawdBot's</strong> machine&mdash;not on yourbro servers. When someone visits your page, the browser fetches the entire file bundle (HTML, JS, CSS) from your agent via an E2E encrypted relay request. The server passes through opaque ciphertext it cannot read. Assets are cached locally by a Service Worker and never hit the network individually.
        </p>
        <div style="padding:0.75rem 1rem;background:#161b22;border-radius:8px;font-family:monospace;font-size:0.82rem;color:#656d76;line-height:1.7;">
          Browser encrypts request &rarr; yourbro relays (opaque) &rarr; ClawdBot encrypts response &rarr; Browser decrypts &rarr; Service Worker caches locally
        </div>
      </div>

      <!-- Security -->
      <div style="margin-bottom:2rem;">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1.25rem;">
          ${icons.shield}
          <h3 style="font-size:1.3rem;font-weight:700;">Security</h3>
        </div>
        <div class="yb-howto-security" style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
          ${[
            { title: "E2E Encryption", desc: "X25519 ECDH key exchange + HKDF-SHA256 derives AES-256-GCM keys. The relay server never sees plaintext." },
            { title: "Implicit Authentication", desc: "E2E encryption IS the authentication \u2014 if decryption succeeds, the sender must possess the paired key. No bearer tokens to steal." },
            { title: "WebSocket Relay", desc: "Your ClawdBot connects outbound\u2014no exposed ports, no public IP. The server is a pass-through pipe." },
            { title: "Zero Server Secrets", desc: "No private keys stored server-side. Encryption keys are derived from your keypair and your ClawdBot\u2019s keypair." },
          ].map((s, i) => `
            <div style="padding:1.25rem;${i % 2 === 0 ? "border-right:1px solid #21262d;" : ""}${i < 2 ? "border-bottom:1px solid #21262d;" : ""}">
              <div style="font-weight:600;font-size:0.95rem;margin-bottom:0.35rem;">${s.title}</div>
              <div style="color:#8b949e;font-size:0.85rem;line-height:1.55;">${s.desc}</div>
            </div>
          `).join("")}
        </div>
      </div>

    </article>
    </div>
  `;
}

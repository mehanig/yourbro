import { isLoggedIn } from "../lib/api";

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

    <article style="max-width:700px;margin:0 auto;line-height:1.7;">
      <h2 style="font-size:2rem;font-weight:800;margin-bottom:1.5rem;">How to Use</h2>

      <section style="margin-bottom:2rem;">
        <h3 style="font-size:1.3rem;font-weight:700;margin-bottom:0.75rem;color:#58a6ff;">What is yourbro</h3>
        <p style="color:#c9d1d9;">
          yourbro is a platform for AI-published pages with scoped storage. Your ClawdBot agent publishes web pages and stores data on your machine. Each agent gets its own isolated namespace — no data leaks between agents or users.
        </p>
      </section>

      <section style="margin-bottom:2rem;">
        <h3 style="font-size:1.3rem;font-weight:700;margin-bottom:0.75rem;color:#58a6ff;">What is ClawdBot (OpenClaw)</h3>
        <p style="color:#c9d1d9;">
          ClawdBot is an open-source personal AI assistant that runs on your devices. It connects via messaging platforms like Telegram, WhatsApp, Discord, and more. yourbro gives ClawdBot the ability to publish and manage web pages on your behalf.
        </p>
      </section>

      <section style="margin-bottom:2rem;">
        <h3 style="font-size:1.3rem;font-weight:700;margin-bottom:0.75rem;color:#58a6ff;">Getting Started</h3>
        <ol style="color:#c9d1d9;padding-left:1.5rem;">
          <li style="margin-bottom:0.5rem;">Sign in to yourbro with your Google account.</li>
          <li style="margin-bottom:0.5rem;">Install &amp; run the yourbro skill from the marketplace on your ClawdBot.</li>
          <li style="margin-bottom:0.5rem;">Pair your ClawdBot with yourbro via the dashboard pairing code.</li>
          <li style="margin-bottom:0.5rem;">Your ClawdBot can now publish pages!</li>
        </ol>
      </section>

      <section style="margin-bottom:2rem;">
        <h3 style="font-size:1.3rem;font-weight:700;margin-bottom:0.75rem;color:#58a6ff;">How Pairing Works</h3>
        <p style="color:#c9d1d9;">
          Your agent generates an Ed25519 keypair locally. You enter the pairing code from the dashboard. The browser and agent exchange public keys securely. All subsequent requests are cryptographically signed using RFC 9421 HTTP Message Signatures.
        </p>
      </section>

      <section style="margin-bottom:2rem;">
        <h3 style="font-size:1.3rem;font-weight:700;margin-bottom:0.75rem;color:#58a6ff;">How Storage Works</h3>
        <p style="color:#c9d1d9;">
          Data lives on <strong>your</strong> machine (agent's SQLite database), not on yourbro servers. Published pages fetch data directly from your agent endpoint. Zero-trust architecture: the yourbro server never sees your data.
        </p>
      </section>

      <section style="margin-bottom:2rem;">
        <h3 style="font-size:1.3rem;font-weight:700;margin-bottom:0.75rem;color:#58a6ff;">Security</h3>
        <ul style="color:#c9d1d9;padding-left:1.5rem;">
          <li style="margin-bottom:0.5rem;">Ed25519 keypairs (like SSH keys) — generated and stored locally.</li>
          <li style="margin-bottom:0.5rem;">RFC 9421 HTTP Message Signatures on every request.</li>
          <li style="margin-bottom:0.5rem;">Content-Digest header for body integrity verification.</li>
          <li style="margin-bottom:0.5rem;">No API tokens stored server-side.</li>
        </ul>
      </section>
    </article>
  `;
}

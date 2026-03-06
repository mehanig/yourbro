import { API_BASE } from "../lib/api";

export function renderLogin(container: HTMLElement) {
  const apiBase = API_BASE;
  container.innerHTML = `
    <style>
      @media(max-width:700px){
        .yb-steps{flex-direction:column !important;}
        .yb-features{grid-template-columns:1fr !important;}
        .yb-hero h1{font-size:2.5rem !important;}
        .yb-hero-image{max-width:100% !important;}
        .yb-step{padding:2rem 1.5rem !important;}
      }
    </style>

    <!-- Hero — full viewport -->
    <section class="yb-hero" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:1.5rem;text-align:center;padding:0 1.5rem;">
      <img src="/yourbro_logo.png" alt="yourbro" style="width:120px;height:auto;margin-bottom:-0.5rem;" />
      <h1 style="font-size:3.5rem;font-weight:800;letter-spacing:-0.03em;margin:0;">yourbro</h1>
      <p style="font-size:1.4rem;color:#e6edf3;font-weight:600;margin:0;max-width:600px;">
        Let your ClawdBot publish web pages with end-to-end encryption
      </p>
      <img class="yb-hero-image" src="/yourbro_image.jpeg" alt="Your bro and ClawdBot hanging out" style="max-width:680px;width:100%;border-radius:16px;margin:0.5rem 0;" />
      <p style="color:#8b949e;font-size:1.05rem;max-width:550px;line-height:1.6;margin:0;">
        Your ClawdBot publishes pages to the web via an encrypted relay. Page content is end-to-end encrypted&mdash;the server never sees what you publish. No exposed ports, no cloud storage.
      </p>
      <div style="display:flex;gap:1rem;align-items:center;margin-top:0.5rem;flex-wrap:wrap;justify-content:center;">
        <a href="${apiBase}/auth/google"
           style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 2rem;background:#e6edf3;color:#0d1117;border-radius:8px;text-decoration:none;font-weight:600;font-size:1.05rem;transition:opacity 0.2s;"
           onmouseover="this.style.opacity='0.85'"
           onmouseout="this.style.opacity='1'">
          Sign in with Google
        </a>
        <a href="#how-it-works"
           style="color:#58a6ff;text-decoration:none;font-size:1rem;font-weight:500;"
           onclick="event.preventDefault();document.getElementById('how-it-works')?.scrollIntoView({behavior:'smooth'})">
          Learn more &darr;
        </a>
      </div>
    </section>

    <!-- How It Works — full-bleed alternating bands -->
    <section id="how-it-works" style="background:#161b22;padding:5rem 1.5rem;">
      <h2 style="text-align:center;font-size:2rem;font-weight:700;margin:0 0 3rem;">How It Works</h2>
      <div class="yb-steps" style="display:flex;max-width:1100px;margin:0 auto;gap:0;">
        <div class="yb-step" style="flex:1;padding:2rem 2.5rem;text-align:center;border-right:1px solid #30363d;">
          <div style="font-size:2.5rem;font-weight:800;color:#58a6ff;margin-bottom:0.75rem;">1</div>
          <h3 style="font-size:1.15rem;font-weight:600;margin:0 0 0.5rem;">Sign in</h3>
          <p style="color:#8b949e;font-size:0.95rem;line-height:1.6;margin:0;">Create your account with Google. One click and you're ready.</p>
        </div>
        <div class="yb-step" style="flex:1;padding:2rem 2.5rem;text-align:center;border-right:1px solid #30363d;">
          <div style="font-size:2.5rem;font-weight:800;color:#58a6ff;margin-bottom:0.75rem;">2</div>
          <h3 style="font-size:1.15rem;font-weight:600;margin:0 0 0.5rem;">Connect your agent</h3>
          <p style="color:#8b949e;font-size:0.95rem;line-height:1.6;margin:0;">Install the yourbro skill on your ClawdBot. It connects via WebSocket relay&mdash;no exposed ports needed. Pair with a one-time code.</p>
        </div>
        <div class="yb-step" style="flex:1;padding:2rem 2.5rem;text-align:center;">
          <div style="font-size:2.5rem;font-weight:800;color:#58a6ff;margin-bottom:0.75rem;">3</div>
          <h3 style="font-size:1.15rem;font-weight:600;margin:0 0 0.5rem;">Publish pages</h3>
          <p style="color:#8b949e;font-size:0.95rem;line-height:1.6;margin:0;">Your ClawdBot publishes pages delivered via E2E encrypted relay. The server never sees your content.</p>
        </div>
      </div>
    </section>

    <!-- Key Features — full-bleed -->
    <section style="padding:5rem 1.5rem;">
      <h2 style="text-align:center;font-size:2rem;font-weight:700;margin:0 0 3rem;">Key Features</h2>
      <div class="yb-features" style="display:grid;grid-template-columns:repeat(2,1fr);gap:0;max-width:1000px;margin:0 auto;">
        <div style="padding:2rem 2.5rem;border-bottom:1px solid #21262d;border-right:1px solid #21262d;">
          <h3 style="font-size:1.15rem;font-weight:600;margin:0 0 0.5rem;">E2E Encrypted Pages</h3>
          <p style="color:#8b949e;font-size:0.95rem;line-height:1.6;margin:0;">Page content is encrypted with X25519 + AES-256-GCM before leaving your browser. The server is a blind relay&mdash;it never sees your pages.</p>
        </div>
        <div style="padding:2rem 2.5rem;border-bottom:1px solid #21262d;">
          <h3 style="font-size:1.15rem;font-weight:600;margin:0 0 0.5rem;">No Exposed Ports</h3>
          <p style="color:#8b949e;font-size:0.95rem;line-height:1.6;margin:0;">Your ClawdBot connects outbound via WebSocket. No port forwarding, no public IP, no firewall rules.</p>
        </div>
        <div style="padding:2rem 2.5rem;border-right:1px solid #21262d;">
          <h3 style="font-size:1.15rem;font-weight:600;margin:0 0 0.5rem;">Cryptographic Security</h3>
          <p style="color:#8b949e;font-size:0.95rem;line-height:1.6;margin:0;">X25519 key exchange, AES-256-GCM encryption, and E2E encrypted relay.</p>
        </div>
        <div style="padding:2rem 2.5rem;">
          <h3 style="font-size:1.15rem;font-weight:600;margin:0 0 0.5rem;">Built for ClawdBot</h3>
          <p style="color:#8b949e;font-size:0.95rem;line-height:1.6;margin:0;">Designed for ClawdBot (OpenClaw)&mdash;the open-source AI assistant that runs on your devices.</p>
        </div>
      </div>
    </section>

    <!-- Bottom CTA — full-bleed -->
    <section style="background:#161b22;text-align:center;padding:5rem 1.5rem;">
      <h2 style="font-size:2rem;font-weight:700;margin:0 0 1.5rem;">Ready to get started?</h2>
      <div style="display:flex;gap:1rem;align-items:center;justify-content:center;flex-wrap:wrap;">
        <a href="${apiBase}/auth/google"
           style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 2rem;background:#e6edf3;color:#0d1117;border-radius:8px;text-decoration:none;font-weight:600;font-size:1.05rem;transition:opacity 0.2s;"
           onmouseover="this.style.opacity='0.85'"
           onmouseout="this.style.opacity='1'">
          Sign in with Google
        </a>
        <a href="#/how-to-use" style="color:#58a6ff;text-decoration:none;font-size:1rem;font-weight:500;">
          How to Use &rarr;
        </a>
      </div>
    </section>
  `;
}

export function renderLogin(container: HTMLElement) {
  container.innerHTML = `
    <style>
      @media(max-width:700px){
        .yb-steps{grid-template-columns:1fr !important;}
        .yb-features{grid-template-columns:1fr !important;}
        .yb-hero h1{font-size:2.5rem !important;}
      }
    </style>
    <div style="max-width:900px;margin:0 auto;padding:0 1.5rem 4rem;">

      <!-- Hero -->
      <section class="yb-hero" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:90vh;gap:1.5rem;text-align:center;background:linear-gradient(180deg,#0d1117 0%,#161b22 100%);margin:0 -1.5rem;padding:0 1.5rem;">
        <h1 style="font-size:3.5rem;font-weight:800;letter-spacing:-0.03em;margin:0;">yourbro</h1>
        <p style="font-size:1.4rem;color:#e6edf3;font-weight:600;margin:0;max-width:600px;">
          Let your AI agents publish and manage web pages
        </p>
        <p style="color:#8b949e;font-size:1.05rem;max-width:550px;line-height:1.6;margin:0;">
          Your ClawdBot agent builds pages, stores data in its own scoped SQLite, and publishes them to the web through yourbro. No cloud databases, no CMS&mdash;just your agent and its storage.
        </p>
        <div style="display:flex;gap:1rem;align-items:center;margin-top:0.5rem;flex-wrap:wrap;justify-content:center;">
          <a href="/auth/google"
             style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.5rem;background:#e6edf3;color:#0d1117;border-radius:8px;text-decoration:none;font-weight:600;font-size:1rem;transition:opacity 0.2s;"
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

      <!-- How It Works -->
      <section id="how-it-works" style="padding:4rem 0 2rem;">
        <h2 style="text-align:center;font-size:1.8rem;font-weight:700;margin:0 0 2rem;">How It Works</h2>
        <div class="yb-steps" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem;">
          <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem;">
            <div style="font-size:1.5rem;font-weight:700;color:#58a6ff;margin-bottom:0.5rem;">1.</div>
            <h3 style="font-size:1.1rem;font-weight:600;margin:0 0 0.5rem;">Sign in</h3>
            <p style="color:#8b949e;font-size:0.95rem;line-height:1.5;margin:0;">Create your account with Google. One click and you're ready.</p>
          </div>
          <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem;">
            <div style="font-size:1.5rem;font-weight:700;color:#58a6ff;margin-bottom:0.5rem;">2.</div>
            <h3 style="font-size:1.1rem;font-weight:600;margin:0 0 0.5rem;">Connect your agent</h3>
            <p style="color:#8b949e;font-size:0.95rem;line-height:1.5;margin:0;">Install the yourbro skill on your ClawdBot (OpenClaw) agent and pair it with your account.</p>
          </div>
          <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem;">
            <div style="font-size:1.5rem;font-weight:700;color:#58a6ff;margin-bottom:0.5rem;">3.</div>
            <h3 style="font-size:1.1rem;font-weight:600;margin:0 0 0.5rem;">Publish pages</h3>
            <p style="color:#8b949e;font-size:0.95rem;line-height:1.5;margin:0;">Your agent creates and manages web pages with its own scoped storage. You stay in control.</p>
          </div>
        </div>
      </section>

      <!-- Key Features -->
      <section style="padding:2rem 0;">
        <h2 style="text-align:center;font-size:1.8rem;font-weight:700;margin:0 0 2rem;">Key Features</h2>
        <div class="yb-features" style="display:grid;grid-template-columns:repeat(2,1fr);gap:1.25rem;">
          <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem;">
            <h3 style="font-size:1.1rem;font-weight:600;margin:0 0 0.5rem;">Zero-Trust Storage</h3>
            <p style="color:#8b949e;font-size:0.95rem;line-height:1.5;margin:0;">Data lives in your ClawdBot's scoped SQLite storage. The yourbro server never sees your data.</p>
          </div>
          <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem;">
            <h3 style="font-size:1.1rem;font-weight:600;margin:0 0 0.5rem;">AI-Native Publishing</h3>
            <p style="color:#8b949e;font-size:0.95rem;line-height:1.5;margin:0;">Your agent publishes pages via API. No manual CMS needed.</p>
          </div>
          <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem;">
            <h3 style="font-size:1.1rem;font-weight:600;margin:0 0 0.5rem;">Cryptographic Security</h3>
            <p style="color:#8b949e;font-size:0.95rem;line-height:1.5;margin:0;">Ed25519 keypairs, RFC 9421 HTTP signatures, and content-digest verification.</p>
          </div>
          <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem;">
            <h3 style="font-size:1.1rem;font-weight:600;margin:0 0 0.5rem;">Open Source Agent</h3>
            <p style="color:#8b949e;font-size:0.95rem;line-height:1.5;margin:0;">Built for ClawdBot (OpenClaw)&mdash;the open-source AI assistant that runs on your devices.</p>
          </div>
        </div>
      </section>

      <!-- Bottom CTA -->
      <section style="text-align:center;padding:3rem 0 1rem;border-top:1px solid #30363d;margin-top:2rem;">
        <h2 style="font-size:1.6rem;font-weight:700;margin:0 0 1rem;">Ready to get started?</h2>
        <div style="display:flex;gap:1rem;align-items:center;justify-content:center;flex-wrap:wrap;">
          <a href="/auth/google"
             style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.5rem;background:#e6edf3;color:#0d1117;border-radius:8px;text-decoration:none;font-weight:600;font-size:1rem;transition:opacity 0.2s;"
             onmouseover="this.style.opacity='0.85'"
             onmouseout="this.style.opacity='1'">
            Sign in with Google
          </a>
          <a href="#/how-to-use" style="color:#58a6ff;text-decoration:none;font-size:1rem;font-weight:500;">
            How to Use &rarr;
          </a>
        </div>
      </section>

    </div>
  `;
}

import { isLoggedIn } from "../lib/api";

const icons = {
  globe: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />
    </svg>
  ),
  bot: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  ),
  link: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  shield: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" />
    </svg>
  ),
};

const steps = [
  { n: 1, title: "Sign in", desc: "Create your account with Google." },
  { n: 2, title: "Install the yourbro skill", desc: "Install the yourbro skill on your OpenClaw. It connects outbound via WebSocket. No port forwarding or public IP needed." },
  { n: 3, title: "Pair your OpenClaw", desc: "Enter the one-time pairing code from your OpenClaw. This sets up end-to-end encryption between your browser and your OpenClaw." },
  { n: 4, title: "Publish pages", desc: "Publish public or private pages. All traffic is end-to-end encrypted. The server never sees your content." },
];

const security = [
  { title: "E2E Encryption", desc: "All traffic is end-to-end encrypted. The server never sees your content, not even for public pages." },
  { title: "Implicit Authentication", desc: "If decryption succeeds, you're authenticated. No passwords or tokens to steal." },
  { title: "No Exposed Ports", desc: "Your OpenClaw connects outbound. No open ports, no public IP needed." },
  { title: "Zero Server Secrets", desc: "No private keys on the server. Your data lives on your machine." },
];

export function HowToUsePage() {
  const navLink = isLoggedIn() ? (
    <a href="#/dashboard" style={{ color: "#58a6ff", textDecoration: "none" }}>Dashboard</a>
  ) : (
    <a href="#/login" style={{ color: "#58a6ff", textDecoration: "none" }}>Sign In</a>
  );

  return (
    <>
      <style>{`
        @media(max-width:700px){
          .yb-howto-grid{grid-template-columns:1fr !important;}
          .yb-howto-security{grid-template-columns:1fr !important;}
          .yb-howto-header{flex-direction:column;gap:1rem !important;align-items:flex-start !important;}
          .yb-howto-col{border-right:none !important;padding:1.5rem 0 !important;border-bottom:1px solid #21262d;}
          .yb-howto-col:last-child{border-bottom:none;}
          .yb-howto-sec-item{border-right:none !important;border-bottom:1px solid #21262d !important;padding:1.25rem 0 !important;}
          .yb-howto-sec-item:last-child{border-bottom:none !important;}
        }
      `}</style>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <header className="yb-howto-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <a href="#/" style={{ display: "flex", alignItems: "center", gap: "0.75rem", textDecoration: "none", color: "#e6edf3" }}>
              <img src="/yourbro_logo.png" alt="" style={{ width: 36, height: "auto" }} />
              <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>yourbro</h1>
            </a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>{navLink}</div>
        </header>

        <article style={{ maxWidth: 740, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "3.5rem", padding: "2rem 0" }}>
            <h2 style={{ fontSize: "2.2rem", fontWeight: 800, marginBottom: "0.75rem" }}>How to Use</h2>
            <p style={{ color: "#8b949e", fontSize: "1.1rem", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
              Publish public or private pages via an encrypted relay. The server never sees your content.
            </p>
          </div>

          {/* Two-column intro */}
          <div className="yb-howto-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: "3rem" }}>
            <div className="yb-howto-col" style={{ padding: "1.5rem 1.5rem 1.5rem 0", borderRight: "1px solid #21262d" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                {icons.globe}
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>What is yourbro</h3>
              </div>
              <p style={{ color: "#8b949e", fontSize: "0.92rem", lineHeight: 1.65 }}>
                A zero-knowledge platform for publishing web pages. All traffic is end-to-end encrypted. Your OpenClaw connects via WebSocket, no exposed ports needed. The server never sees what you publish.
              </p>
            </div>
            <div className="yb-howto-col" style={{ padding: "1.5rem 0 1.5rem 1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                {icons.bot}
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>What is OpenClaw</h3>
              </div>
              <p style={{ color: "#8b949e", fontSize: "0.92rem", lineHeight: 1.65 }}>
                An open-source personal AI assistant that runs on your devices. Connects via Telegram, WhatsApp, Discord, and more. yourbro gives it the ability to publish and manage web pages.
              </p>
            </div>
          </div>

          {/* Getting Started */}
          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "1.25rem" }}>Getting Started</h3>
            {steps.map((s) => (
              <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: "1rem", padding: "1rem 0", borderBottom: "1px solid #21262d" }}>
                <div style={{ flexShrink: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.9rem", color: "#58a6ff" }}>{s.n}</div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>{s.title}</div>
                  <div style={{ color: "#8b949e", fontSize: "0.9rem", lineHeight: 1.55 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* How Pairing Works */}
          <div style={{ marginBottom: "2.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
              {icons.link}
              <h3 style={{ fontSize: "1.15rem", fontWeight: 700 }}>How Pairing Works</h3>
            </div>
            <p style={{ color: "#8b949e", fontSize: "0.92rem", lineHeight: 1.65 }}>
              Your OpenClaw generates a keypair on startup and prints a one-time pairing code. You enter that code in your dashboard. Your browser and OpenClaw exchange public keys, and from that point on all communication is end-to-end encrypted. Only your account can pair with your OpenClaw.
            </p>
          </div>

          {/* How Page Delivery Works */}
          <div style={{ marginBottom: "2.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
              {icons.shield}
              <h3 style={{ fontSize: "1.15rem", fontWeight: 700 }}>How Page Delivery Works</h3>
            </div>
            <p style={{ color: "#8b949e", fontSize: "0.92rem", lineHeight: 1.65 }}>
              Pages live on <strong style={{ color: "#e6edf3" }}>your</strong> machine, not on yourbro servers. When someone visits your page, the content is fetched through an encrypted relay. The server only passes through data it cannot read. Paired users can see all your pages. Anonymous visitors can only see pages you've marked as public.
            </p>
          </div>

          {/* Security */}
          <div style={{ marginBottom: "2rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "1.25rem" }}>Security</h3>
            <div className="yb-howto-security" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {security.map((s, i) => (
                <div key={s.title} className="yb-howto-sec-item" style={{
                  padding: "1.25rem",
                  borderRight: i % 2 === 0 ? "1px solid #21262d" : undefined,
                  borderBottom: i < 2 ? "1px solid #21262d" : undefined,
                }}>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: "0.35rem" }}>{s.title}</div>
                  <div style={{ color: "#8b949e", fontSize: "0.85rem", lineHeight: 1.55 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>
    </>
  );
}

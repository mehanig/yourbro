import { useEffect } from "react";
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
  { n: 4, title: "Publish pages", desc: "Publish public, shared, or private pages. Share with specific Google accounts, or keep pages private. All traffic is end-to-end encrypted." },
];

const security = [
  { title: "E2E Encryption", desc: "All traffic is end-to-end encrypted. The server never sees your content, not even for public pages." },
  { title: "Implicit Authentication", desc: "If decryption succeeds, you're authenticated. No passwords or tokens to steal." },
  { title: "No Exposed Ports", desc: "Your OpenClaw connects outbound. No open ports, no public IP needed." },
  { title: "Zero Server Secrets", desc: "No private keys on the server. Your data lives on your machine." },
];

// Section anchor link style
const anchorStyle: React.CSSProperties = {
  color: "inherit",
  textDecoration: "none",
};

function SectionHeading({ id, icon, children, size = "1.15rem" }: {
  id: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  size?: string;
}) {
  return (
    <div id={id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem", scrollMarginTop: "1.5rem" }}>
      {icon}
      <h3 style={{ fontSize: size, fontWeight: 700 }}>
        <a href={`#/how-to-use?s=${id}`} style={anchorStyle}>{children}</a>
      </h3>
    </div>
  );
}

export function HowToUsePage() {
  const navLink = isLoggedIn() ? (
    <a href="#/dashboard" style={{ color: "#58a6ff", textDecoration: "none" }}>Dashboard</a>
  ) : (
    <a href="#/login" style={{ color: "#58a6ff", textDecoration: "none" }}>Sign In</a>
  );

  // Scroll to section from ?s= query param on mount
  useEffect(() => {
    const hash = window.location.hash; // e.g. #/how-to-use?s=shared-pages
    const match = hash.match(/[?&]s=([^&]+)/);
    if (match) {
      const el = document.getElementById(match[1]);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
      }
    }
  }, []);

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
          .yb-howto-container{padding:1.5rem 1rem !important;}
        }
        code{word-break:break-all;}
      `}</style>
      <div className="yb-howto-container" style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <header className="yb-howto-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <a href="#/" style={{ display: "flex", alignItems: "center", gap: "0.75rem", textDecoration: "none", color: "#e6edf3" }}>
              <img src="/yourbro_logo.png" alt="" style={{ width: 36, height: "auto" }} />
              <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>yourbro</h1>
            </a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>{navLink}</div>
        </header>

        <main><article style={{ maxWidth: 740, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "3.5rem", padding: "2rem 0" }}>
            <h2 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "0.75rem" }}>How to Use</h2>
            <p style={{ color: "#8b949e", fontSize: "1.15rem", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
              Publish public, shared, or private pages via an encrypted relay. The server never sees your content.
            </p>
          </div>

          {/* Two-column intro */}
          <div id="intro" className="yb-howto-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: "3rem", scrollMarginTop: "1.5rem" }}>
            <div className="yb-howto-col" style={{ padding: "1.5rem 1.5rem 1.5rem 0", borderRight: "1px solid #21262d" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                {icons.globe}
                <h3 style={{ fontSize: "1.15rem", fontWeight: 700 }}>What is yourbro</h3>
              </div>
              <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6 }}>
                A zero-knowledge platform for publishing web pages. All traffic is end-to-end encrypted. Your OpenClaw connects via WebSocket, no exposed ports needed. The server never sees what you publish.
              </p>
            </div>
            <div className="yb-howto-col" style={{ padding: "1.5rem 0 1.5rem 1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                {icons.bot}
                <h3 style={{ fontSize: "1.15rem", fontWeight: 700 }}>What is OpenClaw</h3>
              </div>
              <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6 }}>
                An open-source personal AI assistant that runs on your devices. Connects via Telegram, WhatsApp, Discord, and more. yourbro gives it the ability to publish and manage web pages.
              </p>
            </div>
          </div>

          {/* Getting Started */}
          <div id="getting-started" style={{ marginBottom: "3rem", scrollMarginTop: "1.5rem" }}>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "1.25rem" }}>
              <a href="#/how-to-use?s=getting-started" style={anchorStyle}>Getting Started</a>
            </h3>
            {steps.map((s) => (
              <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: "1rem", padding: "1rem 0", borderBottom: "1px solid #21262d" }}>
                <div style={{ flexShrink: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.9rem", color: "#58a6ff" }}>{s.n}</div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>{s.title}</div>
                  <div style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* How Pairing Works */}
          <div style={{ marginBottom: "2.5rem" }}>
            <SectionHeading id="pairing" icon={icons.link}>How Pairing Works</SectionHeading>
            <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6 }}>
              Your OpenClaw generates a keypair on startup and prints a one-time pairing code. You enter that code in your dashboard. Your browser and OpenClaw exchange public keys, and from that point on all communication is end-to-end encrypted. Only your account can pair with your OpenClaw.
            </p>
          </div>

          {/* How Page Delivery Works */}
          <div style={{ marginBottom: "2.5rem" }}>
            <SectionHeading id="page-delivery" icon={icons.shield}>How Page Delivery Works</SectionHeading>
            <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6 }}>
              Pages live on <strong style={{ color: "#e6edf3" }}>your</strong> OpenClaw, not on yourbro servers. When someone visits your page, the content is fetched through an encrypted relay. The server only passes through data it cannot read. Pages have three access levels: <strong style={{ color: "#e6edf3" }}>public</strong> (anyone), <strong style={{ color: "#d2a8ff" }}>shared</strong> (specific Google accounts + access code), or <strong style={{ color: "#e6edf3" }}>private</strong> (paired users only).
            </p>
          </div>

          {/* Shared Pages */}
          <div style={{ marginBottom: "2.5rem" }}>
            <SectionHeading id="shared-pages" icon={icons.shield}>Shared Pages</SectionHeading>
            <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6, marginBottom: "0.75rem" }}>
              Share pages with specific people by their Google account email. Access requires two factors:
            </p>
            <ol style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6, paddingLeft: "1.25rem", margin: "0 0 0.75rem" }}>
              <li style={{ marginBottom: "0.35rem" }}><strong style={{ color: "#e6edf3" }}>Email verification</strong> — the server confirms the viewer's Google identity via a signed token. This proves they own the email address.</li>
              <li style={{ marginBottom: "0.35rem" }}><strong style={{ color: "#e6edf3" }}>Access code</strong> — an 8-character code generated by your OpenClaw and shared out-of-band. This code travels only inside the E2E encrypted channel, so the server never sees it.</li>
            </ol>
            <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6 }}>
              Both factors are required. Even if the server is compromised, an attacker cannot access shared pages without the access code. Ask your OpenClaw to set <code style={{ color: "#e6edf3", background: "#21262d", padding: "0.15rem 0.35rem", borderRadius: 4, fontSize: "0.85rem" }}>allowed_emails</code> in your page's configuration — it will generate an access code and log it for you to share.
            </p>
          </div>

          {/* Custom Domains */}
          <div style={{ marginBottom: "2.5rem" }}>
            <SectionHeading id="custom-domains" icon={icons.globe}>Custom Domains</SectionHeading>
            <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6, marginBottom: "0.75rem" }}>
              You can serve pages from your own domain instead of <code style={{ color: "#e6edf3", background: "#21262d", padding: "0.15rem 0.35rem", borderRadius: 4, fontSize: "0.85rem" }}>yourbro.ai/p/username/slug</code>. With a custom domain, your pages are available at <code style={{ color: "#e6edf3", background: "#21262d", padding: "0.15rem 0.35rem", borderRadius: 4, fontSize: "0.85rem" }}>yourdomain.com/slug</code>.
            </p>
            <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6, marginBottom: "0.75rem" }}>
              Setup takes a few minutes:
            </p>
            <ol style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6, paddingLeft: "1.25rem", margin: "0 0 0.75rem" }}>
              <li style={{ marginBottom: "0.35rem" }}>Add your domain in the dashboard.</li>
              <li style={{ marginBottom: "0.35rem" }}>Create a CNAME record pointing to <code style={{ color: "#e6edf3", background: "#21262d", padding: "0.15rem 0.35rem", borderRadius: 4, fontSize: "0.85rem" }}>custom.yourbro.ai</code> and a TXT record to verify ownership.</li>
              <li style={{ marginBottom: "0.35rem" }}>Click Verify. Once confirmed, a TLS certificate is provisioned automatically via Let's Encrypt.</li>
              <li style={{ marginBottom: "0.35rem" }}>Optionally set a default page to serve at the root of your domain.</li>
            </ol>
            <p style={{ color: "#8b949e", fontSize: "1rem", lineHeight: 1.6 }}>
              No changes to your OpenClaw are needed. Custom domains use the same E2E encrypted relay as <code style={{ color: "#e6edf3", background: "#21262d", padding: "0.15rem 0.35rem", borderRadius: 4, fontSize: "0.85rem" }}>yourbro.ai</code>. The server still never sees your content.
            </p>
          </div>

          {/* Security */}
          <div id="security" style={{ marginBottom: "2rem", scrollMarginTop: "1.5rem" }}>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "1.25rem" }}>
              <a href="#/how-to-use?s=security" style={anchorStyle}>Security</a>
            </h3>
            <div className="yb-howto-security" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {security.map((s, i) => (
                <div key={s.title} className="yb-howto-sec-item" style={{
                  padding: "1.25rem",
                  borderRight: i % 2 === 0 ? "1px solid #21262d" : undefined,
                  borderBottom: i < 2 ? "1px solid #21262d" : undefined,
                }}>
                  <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.35rem" }}>{s.title}</div>
                  <div style={{ color: "#8b949e", fontSize: "0.85rem", lineHeight: 1.6 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </article></main>
      </div>
    </>
  );
}

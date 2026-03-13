import { Navigate } from "react-router-dom";
import { API_BASE, isLoggedIn } from "../lib/api";

export function LoginPage() {
  if (isLoggedIn()) return <Navigate to="/dashboard" replace />;

  const apiBase = API_BASE;

  return (
    <>
      <style>{`
        @media(max-width:700px){
          .yb-steps{flex-direction:column !important;}
          .yb-features{grid-template-columns:1fr !important;}
          .yb-hero h1{font-size:2.5rem !important;}
          .yb-hero{padding-top:2.5rem !important;}
          .yb-hero-image{max-width:100% !important;}
          .yb-step{padding:2rem 1.5rem !important;border-right:none !important;border-bottom:1px solid #30363d !important;}
          .yb-step:last-child{border-bottom:none !important;}
          .yb-feature{border-right:none !important;border-bottom:1px solid #21262d !important;padding:1.5rem 0 !important;}
          .yb-feature:last-child{border-bottom:none !important;}
        }
      `}</style>

      {/* Hero */}
      <section
        className="yb-hero"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: "1.5rem",
          textAlign: "center",
          padding: "0 1.5rem",
        }}
      >
        <img
          src="/yourbro_logo.png"
          alt="yourbro"
          style={{ width: 120, height: "auto", marginBottom: "-0.5rem" }}
        />
        <h1
          style={{
            fontSize: "3.5rem",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            margin: 0,
          }}
        >
          yourbro
        </h1>
        <p
          style={{
            fontSize: "1.4rem",
            color: "#e6edf3",
            fontWeight: 600,
            margin: 0,
            maxWidth: 600,
          }}
        >
          Let your AI publish web pages with zero-knowledge encryption
        </p>
        <img
          className="yb-hero-image"
          src="/yourbro_image.jpeg"
          alt="Your bro and OpenClaw hanging out"
          style={{
            maxWidth: 680,
            width: "100%",
            borderRadius: 16,
            margin: "0.5rem 0",
          }}
        />
        <p
          style={{
            color: "#8b949e",
            fontSize: "1.05rem",
            maxWidth: 550,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Your OpenClaw publishes pages to the web via an encrypted relay.
          All traffic is end-to-end encrypted. The server never sees your content.
          Share pages publicly, with specific people, or keep them private. No exposed ports, no cloud storage.
          Fully{" "}
          <a href="https://github.com/mehanig/yourbro" target="_blank" rel="noreferrer"
            style={{ color: "#58a6ff", textDecoration: "none" }}>open source</a>.
        </p>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            marginTop: "0.5rem",
            paddingBottom: "2rem",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <a
            href={`${apiBase}/auth/google`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem 2rem",
              background: "#e6edf3",
              color: "#0d1117",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "1.05rem",
              transition: "opacity 0.2s",
            }}
            onMouseOver={(e) =>
              ((e.target as HTMLElement).style.opacity = "0.85")
            }
            onMouseOut={(e) => ((e.target as HTMLElement).style.opacity = "1")}
          >
            Sign in with Google
          </a>
          <a
            href="#how-it-works"
            style={{
              color: "#58a6ff",
              textDecoration: "none",
              fontSize: "1rem",
              fontWeight: 500,
            }}
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("how-it-works")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Learn more &darr;
          </a>
        </div>
      </section>

      {/* How It Works */}
      <section
        id="how-it-works"
        style={{ background: "#161b22", padding: "5rem 1.5rem" }}
      >
        <h2
          style={{
            textAlign: "center",
            fontSize: "2rem",
            fontWeight: 700,
            margin: "0 0 3rem",
          }}
        >
          How It Works
        </h2>
        <div
          className="yb-steps"
          style={{
            display: "flex",
            maxWidth: 1100,
            margin: "0 auto",
            gap: 0,
          }}
        >
          {[
            {
              n: 1,
              title: "Sign in",
              desc: "Create your account with Google. One click and you're ready.",
            },
            {
              n: 2,
              title: "Connect your OpenClaw",
              desc: "Install the yourbro skill on your OpenClaw. It connects via WebSocket relay. No exposed ports needed. Pair with a one-time code.",
            },
            {
              n: 3,
              title: "Publish pages",
              desc: "Public, shared, or private. Share with specific Google accounts using email + access code. All traffic is E2E encrypted. The server never sees your content.",
            },
          ].map((s, i) => (
            <div
              key={s.n}
              className="yb-step"
              style={{
                flex: 1,
                padding: "2rem 2.5rem",
                textAlign: "center",
                borderRight: i < 2 ? "1px solid #30363d" : undefined,
              }}
            >
              <div
                style={{
                  fontSize: "2.5rem",
                  fontWeight: 800,
                  color: "#58a6ff",
                  marginBottom: "0.75rem",
                }}
              >
                {s.n}
              </div>
              <h3
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 600,
                  margin: "0 0 0.5rem",
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  color: "#8b949e",
                  fontSize: "0.95rem",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Key Features */}
      <section style={{ padding: "5rem 1.5rem" }}>
        <h2
          style={{
            textAlign: "center",
            fontSize: "2rem",
            fontWeight: 700,
            margin: "0 0 3rem",
          }}
        >
          Key Features
        </h2>
        <div
          className="yb-features"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2,1fr)",
            gap: 0,
            maxWidth: 1000,
            margin: "0 auto",
          }}
        >
          {[
            {
              title: "E2E Encrypted Pages",
              desc: "All page traffic is encrypted with X25519 + AES-256-GCM, even public pages. Anonymous visitors generate ephemeral keys. The server is a blind relay.",
            },
            {
              title: "No Exposed Ports",
              desc: "Your OpenClaw connects outbound via WebSocket. No port forwarding, no public IP, no firewall rules.",
            },
            {
              title: "Custom Domains",
              desc: "Serve pages from your own domain. Point a CNAME, verify ownership, and TLS certificates are provisioned automatically. Your pages, your URL.",
            },
            {
              title: "Share with Specific People",
              desc: "Grant access by Google account email. Two-factor verification: the server confirms identity, a secret access code ensures even a compromised server can't read your pages.",
            },
          ].map((s, i) => (
            <div
              key={s.title}
              className="yb-feature"
              style={{
                padding: "2rem 2.5rem",
                borderBottom: i < 2 ? "1px solid #21262d" : undefined,
                borderRight: i % 2 === 0 ? "1px solid #21262d" : undefined,
              }}
            >
              <h3
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 600,
                  margin: "0 0 0.5rem",
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  color: "#8b949e",
                  fontSize: "0.95rem",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section
        style={{
          background: "#161b22",
          textAlign: "center",
          padding: "5rem 1.5rem",
        }}
      >
        <h2
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            margin: "0 0 1.5rem",
          }}
        >
          Ready to get started?
        </h2>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <a
            href={`${apiBase}/auth/google`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem 2rem",
              background: "#e6edf3",
              color: "#0d1117",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "1.05rem",
              transition: "opacity 0.2s",
            }}
            onMouseOver={(e) =>
              ((e.target as HTMLElement).style.opacity = "0.85")
            }
            onMouseOut={(e) => ((e.target as HTMLElement).style.opacity = "1")}
          >
            Sign in with Google
          </a>
          <a
            href="#/how-to-use"
            style={{
              color: "#58a6ff",
              textDecoration: "none",
              fontSize: "1rem",
              fontWeight: 500,
            }}
          >
            How to Use &rarr;
          </a>
        </div>
      </section>
    </>
  );
}

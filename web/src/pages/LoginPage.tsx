import { API_BASE } from "../lib/api";

export function LoginPage() {
  const apiBase = API_BASE;

  return (
    <>
      <style>{`
        @media(max-width:700px){
          .yb-steps{flex-direction:column !important;}
          .yb-features{grid-template-columns:1fr !important;}
          .yb-hero h1{font-size:2.5rem !important;}
          .yb-hero-image{max-width:100% !important;}
          .yb-step{padding:2rem 1.5rem !important;}
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
          Let your ClawdBot publish web pages with end-to-end encryption
        </p>
        <img
          className="yb-hero-image"
          src="/yourbro_image.jpeg"
          alt="Your bro and ClawdBot hanging out"
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
          Your ClawdBot publishes pages to the web via an encrypted relay. Page
          content is end-to-end encrypted&mdash;the server never sees what you
          publish. No exposed ports, no cloud storage.
        </p>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            marginTop: "0.5rem",
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
              title: "Connect your agent",
              desc: "Install the yourbro skill on your ClawdBot. It connects via WebSocket relay\u2014no exposed ports needed. Pair with a one-time code.",
            },
            {
              n: 3,
              title: "Publish pages",
              desc: "Your ClawdBot publishes pages delivered via E2E encrypted relay. The server never sees your content.",
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
              desc: "Page content is encrypted with X25519 + AES-256-GCM before leaving your browser. The server is a blind relay\u2014it never sees your pages.",
            },
            {
              title: "No Exposed Ports",
              desc: "Your ClawdBot connects outbound via WebSocket. No port forwarding, no public IP, no firewall rules.",
            },
            {
              title: "Cryptographic Security",
              desc: "X25519 key exchange, AES-256-GCM encryption, and E2E encrypted relay.",
            },
            {
              title: "Built for ClawdBot",
              desc: "Designed for ClawdBot (OpenClaw)\u2014the open-source AI assistant that runs on your devices.",
            },
          ].map((s, i) => (
            <div
              key={s.title}
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

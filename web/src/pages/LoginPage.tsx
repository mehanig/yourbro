import { Navigate } from "react-router-dom";
import { API_BASE, isLoggedIn } from "../lib/api";

export function LoginPage() {
  if (isLoggedIn()) return <Navigate to="/dashboard" replace />;

  const apiBase = API_BASE;

  return (
    <main>
      <style>{`
        @media(max-width:700px){
          .yb-steps{flex-direction:column !important;}
          .yb-hero h1{font-size:2.5rem !important;}
          .yb-hero{padding-top:2.5rem !important;min-height:auto !important;padding-bottom:3rem !important;}
          .yb-hero-image{max-width:100% !important;}
          .yb-hero-tagline{font-size:1.15rem !important;}
          .yb-step{padding:1.5rem 1.25rem !important;border-right:none !important;border-bottom:1px solid #30363d !important;}
          .yb-step:last-child{border-bottom:none !important;}
          .yb-examples{flex-direction:column !important;gap:1.5rem !important;}
          .yb-landing-section{padding:2.5rem 1rem !important;}
        }
        @media(max-width:400px){
          .yb-hero h1{font-size:2rem !important;}
          .yb-hero-tagline{font-size:1rem !important;}
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
          background: "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(88,166,255,0.06) 0%, transparent 70%)",
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
          className="yb-hero-tagline"
          style={{
            fontSize: "1.5rem",
            color: "#e6edf3",
            fontWeight: 600,
            margin: 0,
            maxWidth: 600,
            lineHeight: 1.3,
          }}
        >
          Ask your OpenClaw to make you a web page. It's live instantly.
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
            fontSize: "1rem",
            maxWidth: 550,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Pages are served from your machine through an encrypted relay.
          The server never sees your content. Fully{" "}
          <a href="https://github.com/mehanig/yourbro" target="_blank" rel="noreferrer"
            style={{ color: "#58a6ff", textDecoration: "none" }}>open source</a>.
        </p>
        <a
          href={`${apiBase}/auth/google`}
          className="yb-cta"
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
            fontSize: "1rem",
            marginTop: "0.5rem",
            marginBottom: "2rem",
          }}
        >
          Sign in with Google
        </a>
      </section>

      {/* Examples — what you'd say to your OpenClaw */}
      <section className="yb-landing-section" style={{ background: "#161b22", padding: "4rem 1.5rem" }}>
        <h2
          style={{
            textAlign: "center",
            fontSize: "2rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "0 0 2.5rem",
          }}
        >
          Just describe what you need
        </h2>
        <div
          className="yb-examples"
          style={{
            display: "flex",
            gap: "2rem",
            maxWidth: 900,
            margin: "0 auto",
          }}
        >
          {[
            {
              prompt: "\u201CMonitor these 5 websites every 15 minutes, show me a status page.\u201D",
              result: "A live dashboard that updates automatically.",
              accent: "#58a6ff",
            },
            {
              prompt: "\u201CCollect email signups and show me the results.\u201D",
              result: "A form with its own database, shareable via link.",
              accent: "#3fb950",
            },
            {
              prompt: "\u201CShare this report with alice@company.com, no one else.\u201D",
              result: "E2E encrypted. Even the server can\u2019t read it.",
              accent: "#d2a8ff",
            },
          ].map((s) => (
            <div
              key={s.prompt}
              style={{
                flex: 1,
                borderLeft: `2px solid ${s.accent}`,
                paddingLeft: "1.25rem",
              }}
            >
              <p
                style={{
                  color: "#e6edf3",
                  fontSize: "1rem",
                  fontStyle: "italic",
                  lineHeight: 1.5,
                  marginBottom: "0.5rem",
                }}
              >
                {s.prompt}
              </p>
              <p
                style={{
                  color: "#656d76",
                  fontSize: "0.85rem",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {s.result}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section
        id="how-it-works"
        className="yb-landing-section"
        style={{ padding: "4rem 1.5rem" }}
      >
        <h2
          style={{
            textAlign: "center",
            fontSize: "2rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "0 0 2.5rem",
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
              desc: "Create your account with Google. One click.",
            },
            {
              n: 2,
              title: "Connect your OpenClaw",
              desc: "Install the yourbro skill. It connects automatically \u2014 no servers to set up.",
            },
            {
              n: 3,
              title: "Say what you need",
              desc: "Your OpenClaw builds the page and it's live at yourbro.ai/p/you/page-name.",
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
                  fontSize: "1rem",
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
          textAlign: "center",
          padding: "3rem 1.5rem 5rem",
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <a
          href={`${apiBase}/auth/google`}
          className="yb-cta"
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
            fontSize: "1rem",
          }}
        >
          Sign in with Google
        </a>
        <a
          href="#/how-to-use"
          style={{
            color: "#58a6ff",
            textDecoration: "none",
            fontSize: "1rem",
            fontWeight: 600,
          }}
        >
          How to Use &rarr;
        </a>
      </section>
    </main>
  );
}

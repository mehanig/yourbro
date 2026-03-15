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
          .yb-usecases{grid-template-columns:1fr !important;}
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
          Ask your AI to make you a web page. It's live instantly.
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
          Your OpenClaw builds pages and hosts them right from your machine.
          No cloud storage, no devops, no servers to manage. Just say what you need
          and share the link. Public, private, or just for specific people.
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
            href="#use-cases"
            style={{
              color: "#58a6ff",
              textDecoration: "none",
              fontSize: "1rem",
              fontWeight: 500,
            }}
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("use-cases")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            See examples &darr;
          </a>
        </div>
      </section>

      {/* Use Cases */}
      <section
        id="use-cases"
        style={{ background: "#161b22", padding: "5rem 1.5rem" }}
      >
        <h2
          style={{
            textAlign: "center",
            fontSize: "2rem",
            fontWeight: 700,
            margin: "0 0 1rem",
          }}
        >
          What can you do with it?
        </h2>
        <p
          style={{
            textAlign: "center",
            color: "#8b949e",
            fontSize: "1rem",
            margin: "0 0 3rem",
            maxWidth: 550,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.6,
          }}
        >
          Tell your AI what you need. It builds the page and publishes it. Here are some things people do:
        </p>
        <div
          className="yb-usecases"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1.5rem",
            maxWidth: 1000,
            margin: "0 auto",
          }}
        >
          {[
            {
              emoji: "\ud83d\udcca",
              title: "Live dashboards",
              desc: "\"Monitor these 5 websites every 15 minutes, show me a status page.\" Your AI checks the URLs and updates the page automatically.",
            },
            {
              emoji: "\ud83d\udcdd",
              title: "Summarize and share",
              desc: "\"This article is too long, make me a 2-minute version.\" Get a clean summary page with a shareable link, instantly.",
            },
            {
              emoji: "\ud83d\udd12",
              title: "Private reports",
              desc: "Share a page with a specific person by email. They sign in, enter a code, and see the content. No one else can, not even the server.",
            },
            {
              emoji: "\ud83c\udf10",
              title: "Your own domain",
              desc: "Publish pages on your own domain. Point a CNAME, verify, and your pages are live at yourdomain.com with free TLS.",
            },
            {
              emoji: "\ud83e\udde0",
              title: "AI writes, you publish",
              desc: "Just describe what you want. Your AI builds the HTML, CSS, JS \u2014 even interactive apps with charts and forms. One message, live page.",
            },
            {
              emoji: "\ud83d\udce6",
              title: "Data collection",
              desc: "Need a quick form or signup page? Each page gets its own database. Collect emails, feedback, or survey responses.",
            },
          ].map((s) => (
            <div
              key={s.title}
              style={{
                background: "#0d1117",
                border: "1px solid #21262d",
                borderRadius: 12,
                padding: "1.5rem",
              }}
            >
              <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{s.emoji}</div>
              <h3
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 600,
                  margin: "0 0 0.5rem",
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  color: "#8b949e",
                  fontSize: "0.9rem",
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section
        id="how-it-works"
        style={{ padding: "5rem 1.5rem" }}
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
              desc: "Create your account with Google. One click.",
            },
            {
              n: 2,
              title: "Connect your AI",
              desc: "Install the yourbro skill on OpenClaw (your AI assistant). It connects automatically \u2014 no servers to set up.",
            },
            {
              n: 3,
              title: "Say what you need",
              desc: "\"Make me a status page\" or \"summarize this article and publish it.\" Your AI builds it and it's live at yourbro.ai/p/you/page-name.",
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

      {/* Why yourbro */}
      <section style={{ background: "#161b22", padding: "5rem 1.5rem" }}>
        <h2
          style={{
            textAlign: "center",
            fontSize: "2rem",
            fontWeight: 700,
            margin: "0 0 3rem",
          }}
        >
          Why yourbro?
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
              title: "Your data stays yours",
              desc: "Pages are served from your own machine through an encrypted relay. The server never sees your content \u2014 it just passes through encrypted data it can't read.",
            },
            {
              title: "No servers to manage",
              desc: "Your AI connects outbound via WebSocket. No port forwarding, no public IP, no cloud hosting, no DNS configuration. It just works.",
            },
            {
              title: "Share how you want",
              desc: "Public pages for anyone, private pages for you, or shared pages for specific people by email. You control who sees what.",
            },
            {
              title: "Open source",
              desc: "The entire platform is open source. You can see exactly how your data is handled, or host your own instance.",
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
          Ready to try it?
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

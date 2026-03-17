import type { User } from "../lib/api";

export function DashboardHeader({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  return (
    <header
      className="yb-dash-header"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "2rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <a
          href="#/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            textDecoration: "none",
            color: "#e6edf3",
          }}
        >
          <img
            src="/yourbro_logo.png"
            alt=""
            style={{ width: 36, height: "auto" }}
          />
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
            yourbro
          </h1>
        </a>
      </div>
      <div
        className="yb-dash-header-right"
        style={{ display: "flex", alignItems: "center", gap: "1rem" }}
      >
        <span className="yb-dash-header-email" style={{ color: "#656d76", fontSize: "0.9rem" }}>
          {user.email}
        </span>
        <a
          href="#/how-to-use"
          style={{
            color: "#58a6ff",
            textDecoration: "none",
            fontSize: "0.9rem",
          }}
        >
          How to Use
        </a>
        <button className="yb-btn-secondary" onClick={onLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}

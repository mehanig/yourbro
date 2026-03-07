import { useState } from "react";
import type { Token, CreateTokenResponse } from "../lib/api";

export function TokensSection({
  tokens,
  newlyCreated,
  onRevoke,
  onCreate,
}: {
  tokens: Token[];
  newlyCreated: CreateTokenResponse | null;
  onRevoke: (id: number) => void;
  onCreate: (name: string, scopes: string[]) => Promise<CreateTokenResponse>;
}) {
  const [showNew, setShowNew] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(
    newlyCreated?.token ?? null
  );
  const [showForm, setShowForm] = useState(false);
  const [tokenName, setTokenName] = useState("clawdbot");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const name = tokenName.trim() || "clawdbot";
    setCreating(true);
    try {
      const resp = await onCreate(name, ["manage:keys"]);
      setNewToken(resp.token);
      setShowNew(true);
      setShowForm(false);
      setTokenName("clawdbot");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      {tokens.map((t) => (
        <div key={t.id} className="yb-dash-item">
          <div>
            <span style={{ fontWeight: 600 }}>{t.name}</span>
            <span
              style={{
                color: "#656d76",
                marginLeft: "0.5rem",
                fontSize: "0.8rem",
              }}
            >
              {t.scopes.join(", ")}
            </span>
            <div style={{ color: "#656d76", fontSize: "0.75rem", marginTop: "0.2rem" }}>
              Created {new Date(t.created_at).toLocaleDateString()}
              {t.expires_at && <> · Expires {new Date(t.expires_at).toLocaleDateString()}</>}
            </div>
          </div>
          <button
            className="yb-btn-danger"
            onClick={() => {
              if (confirm("Revoke this token?")) onRevoke(t.id);
            }}
          >
            Revoke
          </button>
        </div>
      ))}
      {!showForm ? (
        <button
          className="yb-btn-secondary"
          style={{ marginTop: "0.75rem" }}
          onClick={() => setShowForm(true)}
        >
          + New Token
        </button>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", alignItems: "center" }}>
          <input
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="Token name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creating) handleCreate();
              if (e.key === "Escape") { setShowForm(false); setTokenName("clawdbot"); }
            }}
            style={{
              padding: "0.4rem 0.7rem",
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 6,
              color: "#e6edf3",
              fontSize: "0.85rem",
              flex: 1,
              outline: "none",
            }}
          />
          <button
            className="yb-btn-secondary"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Creating..." : "Create"}
          </button>
          <button
            className="yb-btn-secondary"
            onClick={() => { setShowForm(false); setTokenName("clawdbot"); }}
          >
            Cancel
          </button>
        </div>
      )}
      {showNew && newToken && (
        <div
          style={{
            marginTop: "1rem",
            padding: "1rem",
            background: "#0f1a10",
            borderRadius: 8,
          }}
        >
          <p
            style={{
              color: "#3fb950",
              marginBottom: "0.5rem",
              fontSize: "0.9rem",
            }}
          >
            Token created! Copy it now — it won't be shown again:
          </p>
          <code
            style={{
              display: "block",
              padding: "0.5rem",
              background: "#0d1117",
              borderRadius: 4,
              wordBreak: "break-all",
              color: "#3fb950",
              fontSize: "0.85rem",
            }}
          >
            {newToken}
          </code>
        </div>
      )}
    </>
  );
}

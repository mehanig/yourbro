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

  const handleCreate = async () => {
    const name = prompt("Token name:", "clawdbot") || "clawdbot";
    const resp = await onCreate(name, ["manage:keys"]);
    setNewToken(resp.token);
    setShowNew(true);
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
      <button
        className="yb-btn-secondary"
        style={{ marginTop: "0.75rem" }}
        onClick={handleCreate}
      >
        + New Token
      </button>
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

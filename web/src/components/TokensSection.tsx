import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
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
  const [showModal, setShowModal] = useState(false);
  const [tokenName, setTokenName] = useState("clawdbot");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(
    newlyCreated?.token ?? null
  );

  const handleCreate = async () => {
    const name = tokenName.trim() || "clawdbot";
    setCreating(true);
    try {
      const resp = await onCreate(name, ["manage:keys"]);
      setCreatedToken(resp.token);
    } finally {
      setCreating(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setTokenName("clawdbot");
    setCreatedToken(null);
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
      <button
        className="yb-btn-secondary"
        type="button"
        style={{ marginTop: "0.75rem" }}
        onClick={() => setShowModal(true)}
      >
        + New Token
      </button>

      {showModal && (
        <CreateTokenModal
          tokenName={tokenName}
          onNameChange={setTokenName}
          creating={creating}
          createdToken={createdToken}
          onCreate={handleCreate}
          onClose={closeModal}
        />
      )}
    </>
  );
}

function CreateTokenModal({
  tokenName,
  onNameChange,
  creating,
  createdToken,
  onCreate,
  onClose,
}: {
  tokenName: string;
  onNameChange: (v: string) => void;
  creating: boolean;
  createdToken: string | null;
  onCreate: () => void;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [createdToken]);

  const headingId = "yb-token-modal-title";

  return createPortal(
    <>
      <style>{modalStyles}</style>
      <div
        className="yb-token-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={handleKeyDown}
      >
        <div className="yb-token-modal" ref={modalRef}>
          <div className="yb-token-modal-header">
            <h2 id={headingId}>{createdToken ? "Token Created" : "Create API Token"}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              type="button"
              style={{
                background: "none",
                border: "none",
                color: "#656d76",
                fontSize: "1.5rem",
                cursor: "pointer",
                padding: "0.2rem 0.5rem",
                lineHeight: 1,
              }}
              onMouseOver={(e) => (e.currentTarget.style.color = "#e6edf3")}
              onMouseOut={(e) => (e.currentTarget.style.color = "#656d76")}
              onFocus={(e) => (e.currentTarget.style.color = "#e6edf3")}
              onBlur={(e) => (e.currentTarget.style.color = "#656d76")}
            >
              &times;
            </button>
          </div>

          {!createdToken ? (
            <>
              <label htmlFor="yb-token-name" style={{ color: "#8b949e", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>
                Token name
              </label>
              <input
                id="yb-token-name"
                type="text"
                value={tokenName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="e.g. clawdbot"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !creating) onCreate();
                }}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  color: "#e6edf3",
                  fontSize: "0.9rem",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
                <button className="yb-btn-secondary" type="button" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="yb-btn-secondary"
                  type="button"
                  style={{ background: "#238636", fontWeight: 600 }}
                  onClick={onCreate}
                  disabled={creating}
                >
                  {creating ? "Creating..." : "Create Token"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ color: "#3fb950", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
                Copy this token now — it won't be shown again.
              </p>
              <div style={{ position: "relative" }}>
                <code
                  style={{
                    display: "block",
                    padding: "0.65rem",
                    paddingRight: "3.5rem",
                    background: "#0d1117",
                    borderRadius: 6,
                    wordBreak: "break-all",
                    color: "#3fb950",
                    fontSize: "0.85rem",
                    border: "1px solid #238636",
                  }}
                >
                  {createdToken}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label="Copy token to clipboard"
                  style={{
                    position: "absolute",
                    top: "50%",
                    right: 8,
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: copied ? "#3fb950" : "#656d76",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    padding: "0.25rem 0.4rem",
                  }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
                <button
                  className="yb-btn-secondary"
                  type="button"
                  onClick={onClose}
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

const modalStyles = `
  .yb-token-overlay {
    position: fixed !important;
    top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
    background: rgba(0,0,0,0.75) !important;
    z-index: 9999 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 1rem !important;
  }
  .yb-token-modal {
    background: #161b22 !important;
    border: 1px solid #30363d !important;
    border-radius: 12px !important;
    max-width: 420px !important;
    width: 100% !important;
    padding: 1.5rem !important;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5) !important;
    color: #e6edf3 !important;
    font-family: 'DM Sans', system-ui, -apple-system, sans-serif !important;
  }
  .yb-token-modal-header {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    margin-bottom: 1.25rem !important;
  }
  .yb-token-modal-header h2 {
    margin: 0 !important;
    font-size: 1.15rem !important;
    font-weight: 700 !important;
  }
`;

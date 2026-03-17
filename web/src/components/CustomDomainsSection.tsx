import { useState, useEffect, useCallback } from "react";
import {
  listCustomDomains,
  addCustomDomain,
  verifyCustomDomain,
  updateCustomDomain,
  deleteCustomDomain,
  type CustomDomain,
  type AddDomainResponse,
} from "../lib/api";

export function CustomDomainsSection() {
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [instructions, setInstructions] = useState<AddDomainResponse["instructions"] | null>(null);
  const [error, setError] = useState("");
  const [verifyMsg, setVerifyMsg] = useState<Record<number, string>>({});
  const [editSlug, setEditSlug] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    try {
      const list = await listCustomDomains();
      setDomains(list || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = async () => {
    if (!newDomain.trim()) return;
    setAdding(true);
    setError("");
    setInstructions(null);
    try {
      const resp = await addCustomDomain(newDomain.trim());
      setInstructions(resp.instructions);
      setNewDomain("");
      refresh();
    } catch (e: any) {
      setError(e.message || "Failed to add domain");
    } finally {
      setAdding(false);
    }
  };

  const handleVerify = async (id: number) => {
    setVerifyMsg((m) => ({ ...m, [id]: "Verifying..." }));
    try {
      const resp = await verifyCustomDomain(id);
      setVerifyMsg((m) => ({ ...m, [id]: resp.status === "verified" || resp.status === "already verified" ? "Verified!" : resp.error || "Verification failed" }));
      refresh();
    } catch (e: any) {
      setVerifyMsg((m) => ({ ...m, [id]: e.message || "Verification failed" }));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this custom domain?")) return;
    try {
      await deleteCustomDomain(id);
      refresh();
    } catch {
      // ignore
    }
  };

  const handleSaveSlug = async (id: number) => {
    const slug = editSlug[id] ?? "";
    try {
      await updateCustomDomain(id, slug);
      setEditSlug((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      refresh();
    } catch {
      // ignore
    }
  };

  if (loading) return <p style={{ color: "#8b949e", fontSize: "0.9rem" }}>Loading domains...</p>;

  return (
    <div>
      {/* Add domain form — hidden if user already has one */}
      {domains.length === 0 && <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          type="text"
          placeholder="pages.example.com"
          aria-label="Custom domain"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          style={{
            flex: 1, padding: "0.45rem 0.75rem", background: "#0d1117",
            border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3",
            fontSize: "0.85rem",
          }}
        />
        <button className="yb-btn-secondary" type="button" onClick={handleAdd} disabled={adding}>
          {adding ? "Adding..." : "Add Domain"}
        </button>
      </div>}

      {error && <p style={{ color: "#f85149", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{error}</p>}

      {instructions && (
        <div style={{
          background: "#0d1117", border: "1px solid #30363d", borderRadius: 8,
          padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.85rem", color: "#8b949e",
        }}>
          <p style={{ marginBottom: "0.4rem", color: "#e6edf3", fontWeight: 600 }}>DNS Setup Required:</p>
          <p style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", marginBottom: "0.25rem" }}>{instructions.cname}</p>
          <p style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", marginBottom: "0.25rem" }}>{instructions.txt}</p>
          <p style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}>{instructions.detail}</p>
        </div>
      )}

      {/* Domain list */}
      {domains.length === 0 && !instructions && (
        <p style={{ color: "#8b949e", fontSize: "0.85rem" }}>
          No custom domains configured. Add a domain to serve pages from your own URL.
        </p>
      )}

      {domains.map((d) => (
        <div key={d.id} className="yb-dash-item" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.4rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontWeight: 600, color: "#e6edf3" }}>{d.domain}</span>
              <span style={{
                marginLeft: "0.5rem", fontSize: "0.75rem", padding: "0.15rem 0.5rem",
                borderRadius: 10, background: d.verified ? "#1a3a2a" : "#3d2a1a",
                color: d.verified ? "#3fb950" : "#d29922",
              }}>
                {d.verified ? "verified" : "pending"}
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {!d.verified && (
                <button className="yb-btn-secondary" onClick={() => handleVerify(d.id)} style={{ fontSize: "0.75rem" }}>
                  Verify
                </button>
              )}
              <button className="yb-btn-danger" onClick={() => handleDelete(d.id)}>
                Remove
              </button>
            </div>
          </div>

          {verifyMsg[d.id] && (
            <p style={{ fontSize: "0.8rem", color: verifyMsg[d.id] === "Verified!" ? "#3fb950" : "#f85149" }}>
              {verifyMsg[d.id]}
            </p>
          )}

          {!d.verified && (
            <div style={{ fontSize: "0.8rem", color: "#8b949e", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              TXT _yourbro.{d.domain} → yb-verify={d.verification_token}
            </div>
          )}

          {d.verified && (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem" }}>
              <span style={{ color: "#8b949e" }}>Default page:</span>
              <input
                type="text"
                placeholder="slug"
                aria-label={`Default page slug for ${d.domain}`}
                value={editSlug[d.id] ?? d.default_slug}
                onChange={(e) => setEditSlug((s) => ({ ...s, [d.id]: e.target.value }))}
                style={{
                  width: 160, maxWidth: "100%", padding: "0.3rem 0.5rem", background: "#0d1117",
                  border: "1px solid #30363d", borderRadius: 4, color: "#e6edf3",
                  fontSize: "0.85rem",
                }}
              />
              {editSlug[d.id] !== undefined && editSlug[d.id] !== d.default_slug && (
                <button className="yb-btn-secondary" onClick={() => handleSaveSlug(d.id)} style={{ fontSize: "0.75rem" }}>
                  Save
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

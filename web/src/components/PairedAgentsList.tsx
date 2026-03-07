import type { Agent } from "../lib/api";

export function PairedAgentsList({
  agents,
  getStatus,
  onRemove,
}: {
  agents: Agent[];
  getStatus: (id: string) => string | undefined;
  onRemove: (id: string) => void;
}) {
  const paired = agents.filter((a) => {
    const s = getStatus(a.id);
    return s === "paired" || s === "checking" || !a.is_online;
  });

  if (paired.length === 0) {
    return <p style={{ color: "#656d76" }}>No paired agents yet.</p>;
  }

  return (
    <>
      {paired.map((a) => {
        const isChecking = getStatus(a.id) === "checking";
        return (
          <div key={a.id} className="yb-dash-item">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
              }}
            >
              <span
                style={{
                  color: a.is_online ? "#3fb950" : "#656d76",
                  fontSize: "0.7rem",
                }}
              >
                {a.is_online ? "\u25CF" : "\u25CB"}
              </span>
              <span style={{ fontWeight: 600 }}>{a.name || "unnamed"}</span>
              {isChecking && (
                <span
                  style={{
                    color: "#656d76",
                    fontSize: "0.8rem",
                  }}
                >
                  checking...
                </span>
              )}
            </div>
            {!isChecking && (
              <button
                className="yb-btn-danger"
                onClick={() => {
                  if (confirm("Remove this agent?")) onRemove(a.id);
                }}
              >
                Remove
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

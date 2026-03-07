import { useState } from "react";
import type { Agent } from "../lib/api";

export function AvailableAgentsList({
  agents,
  getStatus,
  onPair,
}: {
  agents: Agent[];
  getStatus: (id: string) => string | undefined;
  onPair: (agentId: string, code: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const available = agents.filter(
    (a) => a.is_online && getStatus(a.id) === "unpaired"
  );

  if (available.length === 0) {
    return <p style={{ color: "#656d76" }}>No unpaired agents online.</p>;
  }

  return (
    <>
      {available.map((a) => (
        <PairForm key={a.id} agent={a} onPair={onPair} />
      ))}
    </>
  );
}

function PairForm({
  agent,
  onPair,
}: {
  agent: Agent;
  onPair: (agentId: string, code: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<{
    show: boolean;
    error: boolean;
    msg: string;
  }>({ show: false, error: false, msg: "" });

  const handlePair = async () => {
    if (!code.trim()) {
      setStatus({ show: true, error: true, msg: "Pairing code is required." });
      return;
    }
    setStatus({ show: true, error: false, msg: "Pairing via relay..." });
    const result = await onPair(agent.id, code.trim());
    if (!result.ok) {
      setStatus({
        show: true,
        error: true,
        msg: `Pairing failed: ${result.error}`,
      });
    }
  };

  return (
    <div
      style={{
        padding: "0.65rem 0",
        borderBottom: "1px solid #21262d",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          marginBottom: "0.5rem",
        }}
      >
        <span style={{ color: "#e3b341", fontSize: "0.7rem" }}>{"\u25CF"}</span>
        <span style={{ fontWeight: 600 }}>{agent.name || "unnamed"}</span>
        <span
          style={{
            color: "#e3b341",
            fontSize: "0.75rem",
            background: "#2d2200",
            padding: "0.1rem 0.4rem",
            borderRadius: 4,
          }}
        >
          needs pairing
        </span>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Pairing code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{
            width: 140,
            padding: "0.4rem 0.5rem",
            background: "#0d1117",
            border: "1px solid #21262d",
            color: "#e6edf3",
            borderRadius: 6,
            fontFamily: "monospace",
            fontSize: "0.85rem",
          }}
        />
        <button
          onClick={handlePair}
          style={{
            padding: "0.4rem 0.8rem",
            background: "#1a2e1d",
            border: "none",
            color: "#3fb950",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: "0.85rem",
            transition: "background 0.15s",
          }}
        >
          Pair
        </button>
      </div>
      {status.show && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem",
            borderRadius: 6,
            fontSize: "0.85rem",
            background: status.error ? "#2d1214" : "#161b22",
            border: `1px solid ${status.error ? "#5a1d22" : "#30363d"}`,
            color: status.error ? "#f85149" : "#8b949e",
          }}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}

import type { Agent } from "../lib/api";
import { PairedAgentsList } from "./PairedAgentsList";
import { AvailableAgentsList } from "./AvailableAgentsList";

export function AgentsGrid({
  agents,
  getStatus,
  onRemove,
  onPair,
}: {
  agents: Agent[];
  getStatus: (id: number) => string | undefined;
  onRemove: (id: number) => void;
  onPair: (agentId: number, code: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <div
      className="yb-dash-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1.25rem",
        alignItems: "start",
      }}
    >
      <div className="yb-dash-section">
        <h2>
          <span className="yb-icon">{"\u25CF"}</span> Paired Agents
        </h2>
        <PairedAgentsList
          agents={agents}
          getStatus={getStatus}
          onRemove={onRemove}
        />
      </div>

      <div className="yb-dash-section">
        <h2>
          <span className="yb-icon" style={{ color: "#e3b341" }}>
            {"\u25D0"}
          </span>{" "}
          Available Agents
        </h2>
        <p
          style={{
            color: "#656d76",
            fontSize: "0.85rem",
            margin: "-0.5rem 0 1rem",
            lineHeight: 1.5,
          }}
        >
          Online agents that need pairing. Enter the code from your agent's
          terminal.
        </p>
        <AvailableAgentsList
          agents={agents}
          getStatus={getStatus}
          onPair={onPair}
        />
      </div>
    </div>
  );
}

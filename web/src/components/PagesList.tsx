import type { PageAnalytics } from "../lib/api";
import type { AgentPages } from "../hooks/usePages";
import { PageCard } from "./PageCard";

export function PagesList({
  agentPages,
  analytics,
  loading,
  username,
  hasAgent,
  anyOnline,
  onAnalytics,
  onDelete,
}: {
  agentPages: AgentPages[];
  analytics: Map<string, PageAnalytics>;
  loading: boolean;
  username: string;
  hasAgent: boolean;
  anyOnline: boolean;
  onAnalytics: (slug: string) => void;
  onDelete: (slug: string, agentId: string) => void;
}) {
  if (loading) {
    return (
      <p style={{ color: "#656d76" }}>Loading pages from agents...</p>
    );
  }

  if (!hasAgent) {
    return (
      <p style={{ color: "#656d76" }}>
        {anyOnline
          ? "Pair an agent to view pages."
          : "Agent offline - connect your agent to manage pages."}
      </p>
    );
  }

  // Detect duplicate slugs across agents
  const slugAgents = new Map<string, string[]>();
  for (const ap of agentPages) {
    for (const p of ap.pages) {
      const existing = slugAgents.get(p.slug) || [];
      existing.push(ap.agent.name);
      slugAgents.set(p.slug, existing);
    }
  }
  const duplicateSlugs = new Set<string>();
  for (const [slug, names] of slugAgents) {
    if (names.length > 1) duplicateSlugs.add(slug);
  }

  const totalPages = agentPages.reduce((sum, ap) => sum + ap.pages.length, 0);
  if (totalPages === 0) {
    return (
      <p style={{ color: "#656d76" }}>
        No pages yet. Use your AI agent to publish pages.
      </p>
    );
  }

  return (
    <>
      {agentPages.map((ap) => (
        <div key={ap.agent.id}>
          {(
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0",
                marginTop: "0.25rem",
                borderBottom: "1px solid #21262d",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#3fb950",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              <span className="yb-sr-only">Online</span>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                {ap.agent.name}
              </span>
              <span style={{ color: "#656d76", fontSize: "0.8rem" }}>
                {ap.pages.length} page{ap.pages.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {ap.pages.length === 0 ? (
            <p style={{ color: "#656d76", fontSize: "0.85rem", padding: "0.5rem 0" }}>
              No pages on this agent.
            </p>
          ) : (
            ap.pages.map((p) => (
              <PageCard
                key={`${ap.agent.id}-${p.slug}`}
                page={p}
                username={username}
                stats={p.public ? analytics.get(p.slug) : undefined}
                agentId={ap.agent.id}
                onAnalytics={onAnalytics}
                onDelete={onDelete}
                duplicateWarning={
                  duplicateSlugs.has(p.slug)
                    ? `Also on: ${slugAgents
                        .get(p.slug)!
                        .filter((n) => n !== ap.agent.name)
                        .join(", ")}`
                    : undefined
                }
              />
            ))
          )}
        </div>
      ))}
    </>
  );
}

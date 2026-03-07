import type { Page, PageAnalytics } from "../lib/api";
import { PageCard } from "./PageCard";

export function PagesList({
  pages,
  analytics,
  loading,
  username,
  agentId,
  hasAgent,
  anyOnline,
  onAnalytics,
  onDelete,
}: {
  pages: Page[];
  analytics: Map<string, PageAnalytics>;
  loading: boolean;
  username: string;
  agentId: number | null;
  hasAgent: boolean;
  anyOnline: boolean;
  onAnalytics: (slug: string) => void;
  onDelete: (slug: string, agentId: number) => void;
}) {
  if (loading) {
    return (
      <p style={{ color: "#656d76" }}>Loading pages from agent...</p>
    );
  }

  if (!hasAgent) {
    return (
      <p style={{ color: "#656d76" }}>
        {anyOnline
          ? "Pair an agent to view pages."
          : "Agent offline \u2014 connect your agent to manage pages."}
      </p>
    );
  }

  if (pages.length === 0) {
    return (
      <p style={{ color: "#656d76" }}>
        No pages yet. Use your AI agent to publish pages.
      </p>
    );
  }

  return (
    <>
      {pages.map((p) => (
        <PageCard
          key={p.slug}
          page={p}
          username={username}
          stats={p.public ? analytics.get(p.slug) : undefined}
          agentId={agentId!}
          onAnalytics={onAnalytics}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

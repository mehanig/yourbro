import { useState, useMemo } from "react";
import Fuse from "fuse.js";
import type { PageAnalytics, Page } from "../lib/api";
import type { AgentPages } from "../hooks/usePages";
import { PageCard } from "./PageCard";

const pagesListStyles = `
  .yb-pages-search {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #e6edf3;
    font-size: 0.85rem;
    outline: none;
    box-sizing: border-box;
  }
  .yb-pages-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #21262d;
    flex-wrap: wrap;
  }
  .yb-pages-pagination-info {
    color: #656d76;
    font-size: 0.75rem;
    margin-left: 0.5rem;
  }
  .yb-page-btn {
    padding: 0.3rem 0.6rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
  }
  @media (max-width: 500px) {
    .yb-pages-pagination {
      gap: 0.3rem;
    }
    .yb-page-btn {
      padding: 0.35rem 0.5rem;
      font-size: 0.75rem;
      min-width: 32px;
    }
    .yb-pages-pagination-info {
      width: 100%;
      text-align: center;
      margin: 0.5rem 0 0 0;
      order: 10;
    }
  }
`;

const PAGE_SIZE = 10;

type FlatPage = Page & { agentId: string; agentName: string };

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
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  // Flatten all pages with agent info
  const allPages = useMemo(() => {
    const flat: FlatPage[] = [];
    for (const ap of agentPages) {
      for (const p of ap.pages) {
        flat.push({ ...p, agentId: ap.agent.id, agentName: ap.agent.name });
      }
    }
    return flat;
  }, [agentPages]);

  // Detect duplicate slugs
  const duplicateSlugs = useMemo(() => {
    const slugAgents = new Map<string, string[]>();
    for (const p of allPages) {
      const existing = slugAgents.get(p.slug) || [];
      existing.push(p.agentName);
      slugAgents.set(p.slug, existing);
    }
    const dups = new Set<string>();
    for (const [slug, names] of slugAgents) {
      if (names.length > 1) dups.add(slug);
    }
    return { set: dups, map: slugAgents };
  }, [allPages]);

  // Fuzzy search
  const fuse = useMemo(
    () =>
      new Fuse(allPages, {
        keys: ["title", "slug"],
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [allPages]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return allPages;
    return fuse.search(query).map((r) => r.item);
  }, [query, fuse, allPages]);

  // Reset page when query changes
  const handleQueryChange = (q: string) => {
    setQuery(q);
    setPage(0);
  };

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Group paginated results by agent for display
  const groupedByAgent = useMemo(() => {
    const groups = new Map<string, { agentId: string; agentName: string; pages: FlatPage[] }>();
    for (const p of paginated) {
      const key = p.agentId;
      if (!groups.has(key)) {
        groups.set(key, { agentId: p.agentId, agentName: p.agentName, pages: [] });
      }
      groups.get(key)!.pages.push(p);
    }
    return Array.from(groups.values());
  }, [paginated]);

  if (loading) {
    return <p style={{ color: "#656d76" }}>Loading pages from agents...</p>;
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

  if (allPages.length === 0) {
    return (
      <p style={{ color: "#656d76" }}>
        No pages yet. Use your AI agent to publish pages.
      </p>
    );
  }

  return (
    <>
      <style>{pagesListStyles}</style>
      <div>
        {/* Search */}
        <div style={{ marginBottom: "1rem" }}>
          <input
            type="text"
            className="yb-pages-search"
            placeholder="Search pages..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
          />
        </div>

      {/* Results info */}
      {query && (
        <p style={{ color: "#656d76", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
          Found {filtered.length} page{filtered.length !== 1 ? "s" : ""}
          {filtered.length !== allPages.length && ` of ${allPages.length}`}
        </p>
      )}

      {/* Pages grouped by agent */}
      {filtered.length === 0 ? (
        <p style={{ color: "#656d76" }}>No pages match your search.</p>
      ) : (
        groupedByAgent.map((group) => (
          <div key={group.agentId}>
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
              />
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                {group.agentName}
              </span>
            </div>
            {group.pages.map((p) => (
              <PageCard
                key={`${p.agentId}-${p.slug}`}
                page={p}
                username={username}
                stats={p.public ? analytics.get(p.slug) : undefined}
                agentId={p.agentId}
                onAnalytics={onAnalytics}
                onDelete={onDelete}
                duplicateWarning={
                  duplicateSlugs.set.has(p.slug)
                    ? `Also on: ${duplicateSlugs.map
                        .get(p.slug)!
                        .filter((n) => n !== p.agentName)
                        .join(", ")}`
                    : undefined
                }
              />
            ))}
          </div>
        ))
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="yb-pages-pagination">
          <button
            className="yb-page-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              background: page === 0 ? "#21262d" : "#30363d",
              color: page === 0 ? "#484f58" : "#e6edf3",
              cursor: page === 0 ? "default" : "pointer",
            }}
          >
            ←
          </button>

          {generatePageNumbers(page, totalPages).map((p, i) =>
            p === "..." ? (
              <span key={`ellipsis-${i}`} style={{ color: "#656d76", padding: "0 0.15rem" }}>
                ···
              </span>
            ) : (
              <button
                key={p}
                className="yb-page-btn"
                onClick={() => setPage(p as number)}
                style={{
                  background: page === p ? "#58a6ff" : "#21262d",
                  color: page === p ? "#0d1117" : "#e6edf3",
                  fontWeight: page === p ? 600 : 400,
                }}
              >
                {(p as number) + 1}
              </button>
            )
          )}

          <button
            className="yb-page-btn"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            style={{
              background: page === totalPages - 1 ? "#21262d" : "#30363d",
              color: page === totalPages - 1 ? "#484f58" : "#e6edf3",
              cursor: page === totalPages - 1 ? "default" : "pointer",
            }}
          >
            →
          </button>

          <span className="yb-pages-pagination-info">
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </span>
        </div>
      )}
      </div>
    </>
  );
}

// Generate smart page numbers with ellipsis
function generatePageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i);
  }

  const pages: (number | "...")[] = [];

  // Always show first page
  pages.push(0);

  if (current > 2) {
    pages.push("...");
  }

  // Pages around current
  for (let i = Math.max(1, current - 1); i <= Math.min(total - 2, current + 1); i++) {
    pages.push(i);
  }

  if (current < total - 3) {
    pages.push("...");
  }

  // Always show last page
  pages.push(total - 1);

  return pages;
}

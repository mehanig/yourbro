import { useState } from "react";
import type { Page, PageAnalytics } from "../lib/api";
import { SharedEmailsPopup } from "./SharedEmailsPopup";

export function PageCard({
  page,
  username,
  stats,
  agentId,
  onAnalytics,
  onDelete,
  duplicateWarning,
}: {
  page: Page;
  username: string;
  stats: PageAnalytics | undefined;
  agentId: string;
  onAnalytics: (slug: string) => void;
  onDelete: (slug: string, agentId: string) => void;
  duplicateWarning?: string;
}) {
  const [showEmails, setShowEmails] = useState(false);

  let statsText = "";
  if (page.public) {
    if (stats && stats.total_views > 0) {
      const parts = [
        `${stats.total_views} view${stats.total_views !== 1 ? "s" : ""}`,
      ];
      if (stats.unique_visitors_30d > 0)
        parts.push(`${stats.unique_visitors_30d} unique`);
      statsText = parts.join(" \u00b7 ");
    } else {
      statsText = "0 views";
    }
  }

  const emailCount = page.allowed_emails?.length ?? 0;

  return (
    <div className="yb-dash-item">
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            flexWrap: "wrap",
          }}
        >
          <a
            href={`/p/${username}/${page.slug}`}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "#58a6ff",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            {page.title || page.slug}
          </a>
          {page.public ? (
            <span
              style={{
                color: "#3fb950",
                fontSize: "0.75rem",
                background: "#1a2e1d",
                padding: "0.1rem 0.4rem",
                borderRadius: 4,
              }}
            >
              public
            </span>
          ) : page.shared ? (
            <span style={{ position: "relative" }}>
              <button
                type="button"
                style={{
                  color: "#d2a8ff",
                  fontSize: "0.75rem",
                  background: "#2d1f3d",
                  padding: "0.25rem 0.5rem",
                  borderRadius: 4,
                  cursor: "pointer",
                  border: "none",
                  fontFamily: "inherit",
                }}
                onClick={() => setShowEmails(!showEmails)}
                aria-expanded={showEmails}
              >
                shared ({emailCount})
              </button>
              {showEmails && page.allowed_emails && (
                <SharedEmailsPopup
                  emails={page.allowed_emails}
                  onClose={() => setShowEmails(false)}
                />
              )}
            </span>
          ) : (
            <span
              style={{
                color: "#8b949e",
                fontSize: "0.75rem",
                background: "#1c1f23",
                padding: "0.1rem 0.4rem",
                borderRadius: 4,
              }}
            >
              private
            </span>
          )}
          {duplicateWarning && (
            <span
              style={{
                color: "#d29922",
                fontSize: "0.75rem",
                background: "#2d2a1d",
                padding: "0.1rem 0.4rem",
                borderRadius: 4,
              }}
              title={duplicateWarning}
            >
              duplicate
            </span>
          )}
        </div>
        <div
          style={{
            color: "#656d76",
            fontSize: "0.8rem",
            marginTop: "0.15rem",
          }}
        >
          /{username}/{page.slug}
          {statsText ? ` \u00b7 ${statsText}` : ""}
        </div>
      </div>
      <div className="yb-page-actions" style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
        {page.public && (
          <button
            className="yb-btn-secondary"
            style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
            onClick={() => onAnalytics(page.slug)}
          >
            Analytics
          </button>
        )}
        <button
          className="yb-btn-danger"
          onClick={() => onDelete(page.slug, agentId)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

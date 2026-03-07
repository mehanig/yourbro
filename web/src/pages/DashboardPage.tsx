import { useState, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { useAgentStream } from "../hooks/useAgentStream";
import { usePairingStatus } from "../hooks/usePairingStatus";
import { usePages } from "../hooks/usePages";
import { useTokens } from "../hooks/useTokens";
import { DashboardHeader } from "../components/DashboardHeader";
import { PagesList } from "../components/PagesList";
import { AgentsGrid } from "../components/AgentsGrid";
import { TokensSection } from "../components/TokensSection";
import { AnalyticsModal } from "../components/AnalyticsModal";

export function DashboardPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const { agents } = useAgentStream();
  const { getStatus, pairAgent, removeAgent } = usePairingStatus(agents);
  const {
    pages,
    analytics,
    loading: pagesLoading,
    deletePage,
    onlineAgentId,
  } = usePages(agents, getStatus);
  const {
    tokens,
    newlyCreated,
    createToken,
    deleteToken,
  } = useTokens();

  const [analyticsSlug, setAnalyticsSlug] = useState<string | null>(null);

  const handlePair = useCallback(
    async (agentId: number, code: string) => {
      if (!user) return { ok: false, error: "Not logged in" };
      return pairAgent(agentId, code, user.username);
    },
    [user, pairAgent]
  );

  const handleDelete = useCallback(
    async (slug: string, agentId: number) => {
      if (!confirm(`Delete page "${slug}"?`)) return;
      const result = await deletePage(slug, agentId);
      if (!result.ok) alert(`Delete failed: ${result.error}`);
    },
    [deletePage]
  );

  if (authLoading || !user) {
    return (
      <p style={{ color: "#8b949e", textAlign: "center", padding: "2rem" }}>
        Loading...
      </p>
    );
  }

  const hasAgent = agents.some(
    (a) => a.is_online && getStatus(a.id) === "paired"
  );
  const anyOnline = agents.some((a) => a.is_online);

  return (
    <>
      <style>{dashboardStyles}</style>
      <div
        style={{ maxWidth: 1060, margin: "0 auto", padding: "2rem 1.5rem" }}
      >
        <DashboardHeader user={user} onLogout={logout} />

        {/* Pages */}
        <div className="yb-dash-section">
          <h2>
            <span className="yb-icon">{"\u25E7"}</span> Pages
          </h2>
          <PagesList
            pages={pages}
            analytics={analytics}
            loading={pagesLoading}
            username={user.username}
            agentId={onlineAgentId}
            hasAgent={hasAgent}
            anyOnline={anyOnline}
            onAnalytics={setAnalyticsSlug}
            onDelete={handleDelete}
          />
        </div>

        {/* Agents */}
        <AgentsGrid
          agents={agents}
          getStatus={getStatus}
          onRemove={removeAgent}
          onPair={handlePair}
        />

        {/* Tokens */}
        <div className="yb-dash-section">
          <h2>
            <span className="yb-icon">{"\u26BF"}</span> API Tokens
          </h2>
          <TokensSection
            tokens={tokens}
            newlyCreated={newlyCreated}
            onRevoke={deleteToken}
            onCreate={createToken}
          />
        </div>
      </div>

      {analyticsSlug && (
        <AnalyticsModal
          slug={analyticsSlug}
          onClose={() => setAnalyticsSlug(null)}
        />
      )}
    </>
  );
}

const dashboardStyles = `
  .yb-dash-section{background:#161b22;border-radius:12px;padding:1.5rem 1.75rem;margin-bottom:1.25rem;}
  .yb-dash-section h2{font-size:1.1rem;font-weight:700;margin:0 0 1rem;display:flex;align-items:center;gap:0.5rem;}
  .yb-dash-section h2 .yb-icon{font-size:1.2rem;opacity:0.7;}
  .yb-dash-item{display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0;border-bottom:1px solid #21262d;}
  .yb-dash-item:last-child{border-bottom:none;}
  .yb-btn-danger{padding:0.3rem 0.7rem;background:transparent;border:1px solid #5a1d22;color:#f85149;border-radius:6px;cursor:pointer;font-size:0.8rem;transition:background 0.15s;}
  .yb-btn-danger:hover{background:#2d1214;}
  .yb-btn-secondary{padding:0.45rem 1rem;background:#21262d;border:none;color:#e6edf3;border-radius:6px;cursor:pointer;font-size:0.85rem;transition:background 0.15s;}
  .yb-btn-secondary:hover{background:#30363d;}
  @media(max-width:700px){
    .yb-dash-grid{grid-template-columns:1fr !important;}
    .yb-dash-header{flex-direction:column;gap:1rem !important;align-items:flex-start !important;}
  }
`;

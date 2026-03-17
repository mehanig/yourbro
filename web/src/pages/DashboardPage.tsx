import { useState, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { useAgentStream } from "../hooks/useAgentStream";
import { usePairingStatus } from "../hooks/usePairingStatus";
import { usePages } from "../hooks/usePages";
import { useTokens } from "../hooks/useTokens";
import { DashboardHeader } from "../components/DashboardHeader";
import { PagesList } from "../components/PagesList";
import { AgentsGrid } from "../components/AgentsGrid";
import { CustomDomainsSection } from "../components/CustomDomainsSection";
import { TokensSection } from "../components/TokensSection";
import { AnalyticsModal } from "../components/AnalyticsModal";

export function DashboardPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const { agents } = useAgentStream();
  const { getStatus, pairAgent, removeAgent } = usePairingStatus(agents);
  const {
    agentPages,
    analytics,
    loading: pagesLoading,
    deletePage,
    hasAgent,
    anyOnline,
  } = usePages(agents, getStatus);
  const {
    tokens,
    newlyCreated,
    createToken,
    deleteToken,
  } = useTokens();

  const [analyticsSlug, setAnalyticsSlug] = useState<string | null>(null);

  const handlePair = useCallback(
    async (agentId: string, code: string) => {
      if (!user) return { ok: false, error: "Not logged in" };
      return pairAgent(agentId, code, user.username);
    },
    [user, pairAgent]
  );

  const handleDelete = useCallback(
    async (slug: string, agentId: string) => {
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

  return (
    <>
      <style>{dashboardStyles}</style>
      <a href="#yb-main" className="yb-skip-link">Skip to main content</a>
      <div
        className="yb-dash-container"
        style={{ maxWidth: 1060, margin: "0 auto", padding: "2rem 1.5rem" }}
      >
        <DashboardHeader user={user} onLogout={logout} />

        {/* Pages */}
        <main id="yb-main">
        <div className="yb-dash-section">
          <h2>
            <span className="yb-icon">{"\u25E7"}</span> Pages
          </h2>
          <PagesList
            agentPages={agentPages}
            analytics={analytics}
            loading={pagesLoading}
            username={user.username}
            hasAgent={hasAgent}
            anyOnline={anyOnline}
            onAnalytics={setAnalyticsSlug}
            onDelete={handleDelete}
          />
        </div>

        {/* Custom Domains */}
        <div className="yb-dash-section">
          <h2>
            <span className="yb-icon">{"\u2B24"}</span> Custom Domains
          </h2>
          <CustomDomainsSection />
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
        </main>
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
  .yb-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
  .yb-skip-link{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;z-index:10000;padding:0.5rem 1rem;background:#58a6ff;color:#0d1117;font-weight:600;border-radius:0 0 6px 0;text-decoration:none;}
  .yb-skip-link:focus{position:fixed;left:0;top:0;width:auto;height:auto;overflow:visible;}
  .yb-dash-section{background:#161b22;border-radius:12px;padding:1.5rem 1.75rem;margin-bottom:1.25rem;}
  .yb-dash-section h2{font-size:1.15rem;font-weight:700;margin:0 0 1rem;display:flex;align-items:center;gap:0.5rem;}
  .yb-dash-section h2 .yb-icon{font-size:1.2rem;opacity:0.7;}
  .yb-dash-item{display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0;border-bottom:1px solid #21262d;}
  .yb-dash-item:last-child{border-bottom:none;}
  .yb-btn-danger{padding:0.3rem 0.7rem;background:transparent;border:1px solid #5a1d22;color:#f85149;border-radius:6px;cursor:pointer;font-size:0.8rem;transition:background 0.15s;}
  .yb-btn-danger:hover{background:#2d1214;}
  .yb-btn-danger:focus-visible{outline:2px solid #f85149;outline-offset:2px;}
  .yb-btn-secondary{padding:0.45rem 1rem;background:#21262d;border:none;color:#e6edf3;border-radius:6px;cursor:pointer;font-size:0.85rem;transition:background 0.15s;}
  .yb-btn-secondary:hover{background:#30363d;}
  .yb-btn-secondary:focus-visible{outline:2px solid #58a6ff;outline-offset:2px;}
  input:focus-visible{outline:2px solid #58a6ff;outline-offset:-1px;}
  @media(max-width:700px){
    .yb-dash-grid{grid-template-columns:1fr !important;}
    .yb-dash-header{flex-direction:column;gap:0.75rem !important;align-items:flex-start !important;}
    .yb-dash-header-right{flex-wrap:wrap;gap:0.5rem 1rem !important;}
    .yb-dash-header-email{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .yb-dash-section{padding:1.25rem 1rem !important;border-radius:10px !important;}
    .yb-dash-container{padding:1.5rem 0.75rem !important;}
    .yb-dash-item{flex-wrap:wrap;gap:0.5rem !important;}
    .yb-page-actions{width:100%;justify-content:flex-end !important;}
  }
  @media(prefers-reduced-motion:reduce){
    *{transition-duration:0.01ms !important;animation-duration:0.01ms !important;}
  }
`;

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { getPageDetailedAnalytics, type PageDetailedAnalytics } from "../lib/api";

export function AnalyticsModal({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<PageDetailedAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    getPageDetailedAnalytics(slug)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, [slug]);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  let lastViewed = "Never";
  if (data?.last_viewed_at) {
    const d = new Date(data.last_viewed_at);
    const diff = Date.now() - d.getTime();
    if (diff < 3600000) lastViewed = `${Math.floor(diff / 60000)}m ago`;
    else if (diff < 86400000) lastViewed = `${Math.floor(diff / 3600000)}h ago`;
    else lastViewed = d.toLocaleDateString();
  }

  const maxViews =
    data?.daily_views && data.daily_views.length > 0
      ? Math.max(...data.daily_views.map((d) => d.views))
      : 0;

  const totalRefViews =
    data?.top_referrers?.reduce((sum, r) => sum + r.count, 0) ?? 0;

  return createPortal(
    <>
      <style>{modalStyles}</style>
      <div
        className="yb-modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="yb-analytics-modal-title"
        onKeyDown={handleKeyDown}
      >
        <div className="yb-modal-card" ref={modalRef}>
          <div className="yb-modal-header">
            <h2 id="yb-analytics-modal-title">Analytics: {slug}</h2>
            <button className="yb-modal-close" onClick={onClose} aria-label="Close" type="button">
              &times;
            </button>
          </div>

          {error && <p className="yb-modal-empty">Failed to load: {error}</p>}

          {!data && !error && (
            <p className="yb-modal-empty">Loading analytics...</p>
          )}

          {data && (
            <>
              <div className="yb-modal-stats">
                <div>
                  <div className="yb-modal-stat-label">Total views</div>
                  <div className="yb-modal-stat-value">{data.total_views}</div>
                </div>
                <div>
                  <div className="yb-modal-stat-label">Unique (30d)</div>
                  <div className="yb-modal-stat-value">
                    {data.unique_visitors_30d}
                  </div>
                </div>
                <div>
                  <div className="yb-modal-stat-label">Last viewed</div>
                  <div className="yb-modal-stat-value-sm">{lastViewed}</div>
                </div>
              </div>

              <div className="yb-modal-section-title">
                Views (last 14 days)
              </div>
              {data.daily_views && data.daily_views.length > 0 ? (
                data.daily_views.slice(0, 14).map((dv) => {
                  const barPct =
                    maxViews > 0
                      ? Math.max(1, Math.round((dv.views / maxViews) * 100))
                      : 1;
                  const dateLabel = new Date(
                    dv.date + "T00:00:00"
                  ).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  });
                  return (
                    <div key={dv.date} className="yb-modal-bar-row">
                      <span className="yb-modal-bar-date">{dateLabel}</span>
                      <div className="yb-modal-bar-track">
                        <div
                          className="yb-modal-bar"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <span className="yb-modal-bar-count">{dv.views}</span>
                      <span className="yb-modal-bar-unique">
                        ({dv.unique_views} uniq)
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="yb-modal-empty">No daily data yet.</p>
              )}

              <div className="yb-modal-section-title">Top Referrers</div>
              {data.top_referrers && data.top_referrers.length > 0 ? (
                data.top_referrers.map((r) => {
                  let label = r.source || "(direct)";
                  try {
                    label = new URL(r.source).hostname;
                  } catch {
                    /* use raw */
                  }
                  const pct =
                    totalRefViews > 0
                      ? Math.round((r.count / totalRefViews) * 100)
                      : 0;
                  return (
                    <div key={r.source} className="yb-modal-ref-row">
                      <span className="yb-modal-ref-source">{label}</span>
                      <span className="yb-modal-ref-count">
                        {r.count}{" "}
                        <span className="yb-modal-ref-pct">({pct}%)</span>
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="yb-modal-empty">No referrer data yet.</p>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

const modalStyles = `
  .yb-modal-overlay {
    position: fixed !important;
    top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
    background: rgba(0,0,0,0.75) !important;
    z-index: 9999 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 1rem !important;
  }
  .yb-modal-card {
    background: #161b22 !important;
    border: 1px solid #30363d !important;
    border-radius: 12px !important;
    max-width: 520px !important;
    width: 100% !important;
    max-height: 85vh !important;
    overflow-y: auto !important;
    padding: 1.5rem !important;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5) !important;
    color: #e6edf3 !important;
    font-family: 'DM Sans', system-ui, -apple-system, sans-serif !important;
  }
  .yb-modal-header {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    margin-bottom: 1.25rem !important;
  }
  .yb-modal-header h2 {
    margin: 0 !important;
    font-size: 1.15rem !important;
    font-weight: 700 !important;
    color: #e6edf3 !important;
  }
  .yb-modal-close {
    background: none !important;
    border: none !important;
    color: #656d76 !important;
    font-size: 1.5rem !important;
    cursor: pointer !important;
    padding: 0.2rem 0.5rem !important;
    line-height: 1 !important;
  }
  .yb-modal-close:hover { color: #e6edf3 !important; }
  .yb-modal-stats {
    display: flex !important;
    gap: 1.5rem !important;
    margin-bottom: 1.5rem !important;
    flex-wrap: wrap !important;
  }
  .yb-modal-stat-label { color: #656d76 !important; font-size: 0.8rem !important; margin-bottom: 0.15rem !important; }
  .yb-modal-stat-value { font-size: 1.5rem !important; font-weight: 700 !important; color: #e6edf3 !important; }
  .yb-modal-stat-value-sm { font-size: 1rem !important; font-weight: 600 !important; color: #8b949e !important; margin-top: 0.25rem !important; }
  .yb-modal-section-title {
    font-size: 0.9rem !important;
    font-weight: 600 !important;
    color: #e6edf3 !important;
    margin: 1.25rem 0 0.6rem !important;
    padding-bottom: 0.4rem !important;
    border-bottom: 1px solid #21262d !important;
  }
  .yb-modal-bar-row {
    display: flex !important;
    align-items: center !important;
    gap: 0.5rem !important;
    margin-bottom: 0.35rem !important;
  }
  .yb-modal-bar-date { color: #8b949e !important; font-size: 0.8rem !important; min-width: 48px !important; text-align: right !important; flex-shrink: 0 !important; }
  .yb-modal-bar-track { flex: 1 !important; min-width: 0 !important; background: #21262d !important; height: 18px !important; border-radius: 3px !important; overflow: hidden !important; }
  .yb-modal-bar { background: #1f6feb !important; height: 100% !important; border-radius: 3px !important; min-width: 3px !important; }
  .yb-modal-bar-count { color: #e6edf3 !important; font-size: 0.8rem !important; flex-shrink: 0 !important; }
  .yb-modal-bar-unique { color: #656d76 !important; font-size: 0.75rem !important; flex-shrink: 0 !important; }
  .yb-modal-ref-row {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    padding: 0.4rem 0 !important;
    border-bottom: 1px solid #21262d !important;
  }
  .yb-modal-ref-row:last-child { border-bottom: none !important; }
  .yb-modal-ref-source { color: #e6edf3 !important; font-size: 0.85rem !important; }
  .yb-modal-ref-count { color: #8b949e !important; font-size: 0.85rem !important; }
  .yb-modal-ref-pct { color: #656d76 !important; }
  .yb-modal-empty { color: #656d76 !important; font-size: 0.85rem !important; }
  @media (max-width: 560px) {
    .yb-modal-card { padding: 1rem !important; margin: 0.5rem !important; }
    .yb-modal-stats { gap: 1rem !important; }
    .yb-modal-stat-value { font-size: 1.2rem !important; }
    .yb-modal-bar-track { max-width: 120px !important; }
  }
`;

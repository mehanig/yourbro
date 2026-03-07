---
title: "feat: Public Page Analytics"
type: feat
status: active
date: 2026-03-07
---

# feat: Public Page Analytics

## Overview

Add basic analytics for public pages on yourbro.ai. When a public page is viewed, record the view in PostgreSQL (on the API server). Page owners can see view counts, unique visitors, and top referrers in their dashboard.

Since all public page requests already pass through the API server (`GET /api/public-page/{username}/{slug}`), we can record analytics at the relay layer without any changes to the agent or encryption model. The server remains zero-knowledge for private pages -- analytics only applies to public pages served via plaintext relay.

## Problem Statement / Motivation

Page owners currently have zero visibility into whether anyone is visiting their public pages. Basic metrics (views, uniques, referrers) are table stakes for any publishing platform and help creators understand what's working.

## Proposed Solution

### Architecture

```
Visitor loads /p/user/slug
  -> shell.html fetches GET /api/public-page/user/slug
     (shell passes document.referrer as X-Referrer header)
  -> API relays to agent, gets 200
  -> API writes response to visitor
  -> API fires async analytics write (buffered channel + worker pool)
     -> INSERT INTO page_views (user_id, slug, ip_hash, referrer, is_bot, viewed_at)

Owner opens dashboard
  -> GET /api/page-analytics (authenticated)
  -> Returns per-page: total_views, unique_visitors, top referrers, last_viewed_at
  -> Dashboard renders inline stats next to each page
```

### Key Design Decisions

1. **Server-side recording only** -- record when the API successfully proxies a 200 from the agent. No client-side beacons.

2. **Referrer from shell** -- the `fetch()` call from shell.html always sends `yourbro.ai` as the HTTP `Referer`. To get the actual traffic source, the shell passes `document.referrer` as an `X-Referrer` header on the API call. This captures where the visitor actually came from (Google, Twitter, direct, etc.).

3. **Async fire-and-forget** -- analytics writes go through a buffered channel with a fixed worker pool (e.g., 4 workers, 256-slot buffer). Zero latency impact on page serving. Workers drain on graceful shutdown.

4. **Hashed IPs** -- store `SHA-256(IP)` for unique visitor counting. No salt rotation (user's choice). Simple and permanent. Unique visitors = `COUNT(DISTINCT ip_hash)` over a time range.

5. **Bot detection** -- store an `is_bot` boolean based on User-Agent heuristic. Dashboard excludes bots by default.

6. **Public pages only** -- private (E2E encrypted) pages have no analytics. The server can't see their content and doesn't know when they're viewed.

## Technical Approach

### 1. Database Migration

**File: `migrations/011_create_page_views.sql`**

```sql
CREATE TABLE IF NOT EXISTS page_views (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug       TEXT NOT NULL,
    ip_hash    TEXT NOT NULL,
    referrer   TEXT NOT NULL DEFAULT '',
    is_bot     BOOLEAN NOT NULL DEFAULT FALSE,
    viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_page_views_user_slug ON page_views (user_id, slug, viewed_at);
CREATE INDEX idx_page_views_user_viewed ON page_views (user_id, viewed_at);
```

Raw events table. No pre-aggregation for v1 -- queries are simple `COUNT(*)` / `COUNT(DISTINCT ip_hash)` with index support. Can add materialized views later if needed.

### 2. Analytics Recorder (Go)

**File: `api/internal/analytics/recorder.go`** (new package)

```go
type PageView struct {
    UserID   int64
    Slug     string
    IPHash   string
    Referrer string
    IsBot    bool
}

type Recorder struct {
    ch   chan PageView
    db   *storage.DB
    wg   sync.WaitGroup
}

func New(db *storage.DB, bufSize, workers int) *Recorder { ... }
func (r *Recorder) Record(v PageView) { ... }  // non-blocking send to channel
func (r *Recorder) Shutdown() { ... }          // close channel, wg.Wait()
```

- `Record()` does a non-blocking channel send. If buffer is full, drop the event (log warning).
- Workers read from channel, call `db.InsertPageView()`.
- `Shutdown()` closes the channel, workers drain remaining events, `wg.Wait()` blocks until done.

### 3. Storage Methods

**File: `api/internal/storage/postgres.go`** (add methods)

```go
func (db *DB) InsertPageView(ctx context.Context, userID int64, slug, ipHash, referrer string, isBot bool) error

func (db *DB) GetPageAnalytics(ctx context.Context, userID int64) ([]PageAnalytics, error)
// Returns per-slug: total_views, unique_visitors (30d), last_viewed_at, top referrers
```

`GetPageAnalytics` query:

```sql
SELECT slug,
       COUNT(*) AS total_views,
       COUNT(DISTINCT ip_hash) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days') AS unique_30d,
       MAX(viewed_at) AS last_viewed_at
FROM page_views
WHERE user_id = $1 AND NOT is_bot
GROUP BY slug
ORDER BY total_views DESC;
```

Top referrers (separate query or subquery per slug):

```sql
SELECT referrer, COUNT(*) AS count
FROM page_views
WHERE user_id = $1 AND slug = $2 AND NOT is_bot AND referrer != ''
GROUP BY referrer
ORDER BY count DESC
LIMIT 5;
```

### 4. Model

**File: `api/internal/models/models.go`** (add struct)

```go
type PageAnalytics struct {
    Slug           string   `json:"slug"`
    TotalViews     int64    `json:"total_views"`
    UniqueVisitors int64    `json:"unique_visitors_30d"`
    LastViewedAt   *string  `json:"last_viewed_at,omitempty"`
    TopReferrers   []Referrer `json:"top_referrers,omitempty"`
}

type Referrer struct {
    Source string `json:"source"`
    Count  int64  `json:"count"`
}
```

### 5. API Endpoint

**File: `api/cmd/server/main.go`**

Inside the authenticated `/api` route group:

```go
r.Get("/api/page-analytics", analyticsHandler.GetAnalytics)
```

Handler returns `[]PageAnalytics` for the authenticated user. Straightforward -- get user ID from session, query DB.

### 6. Public Page Handler -- Record View

**File: `api/cmd/server/main.go`** (modify existing handler at ~line 295)

After successful 200 response from agent, fire analytics:

```go
if resp.Status == 200 && resp.Body != nil {
    // ... existing response write ...

    // Record analytics (async, non-blocking)
    recorder.Record(analytics.PageView{
        UserID:   user.ID,
        Slug:     slug,
        IPHash:   sha256hex(r.RemoteAddr),
        Referrer: r.Header.Get("X-Referrer"),
        IsBot:    isBotUA(r.UserAgent()),
    })
    return
}
```

`sha256hex()` and `isBotUA()` are small utility functions:

```go
func sha256hex(s string) string {
    h := sha256.Sum256([]byte(s))
    return hex.EncodeToString(h[:])
}

func isBotUA(ua string) bool {
    ua = strings.ToLower(ua)
    bots := []string{"bot", "crawler", "spider", "curl", "wget", "python-requests", "go-http-client"}
    for _, b := range bots {
        if strings.Contains(ua, b) { return true }
    }
    return false
}
```

### 7. Shell -- Pass Referrer

**File: `web/public/p/shell.html`** (modify public page fetch)

Add `X-Referrer` header to the public page API call:

```javascript
var publicResp = await fetch(API + '/api/public-page/' +
    encodeURIComponent(username) + '/' + encodeURIComponent(slug), {
    headers: { 'X-Referrer': document.referrer || '' }
});
```

This passes the actual traffic source (e.g., `https://twitter.com/...`) rather than the shell's own URL.

### 8. Dashboard -- Display Analytics

**File: `web/src/lib/api.ts`** (add function)

```typescript
export interface PageAnalytics {
    slug: string;
    total_views: number;
    unique_visitors_30d: number;
    last_viewed_at?: string;
    top_referrers?: { source: string; count: number }[];
}

export function getPageAnalytics(): Promise<PageAnalytics[]> {
    return request("/api/page-analytics");
}
```

**File: `web/src/pages/dashboard.ts`** (modify page list)

Fetch analytics alongside the page list. For each public page, show inline:
- View count (e.g., "142 views")
- Unique visitors 30d (e.g., "89 unique")
- Top referrer if available

Display as small gray text below the page URL, similar to the existing "public" badge style. No charts, no separate page -- just inline numbers. Keep it simple for v1.

```
my-portfolio  [public]
yourbro.ai/p/mehanig/my-portfolio
142 views | 89 unique (30d) | top: twitter.com
```

Private pages show no analytics (data doesn't exist).

## Acceptance Criteria

- [x] `migrations/011_create_page_views.sql` creates `page_views` table with indexes
- [x] Public page views are recorded asynchronously after successful 200 relay response
- [x] IP addresses are stored as SHA-256 hashes (never raw)
- [x] Bot traffic is detected via User-Agent and flagged with `is_bot`
- [x] `GET /api/page-analytics` returns per-page stats for the authenticated user
- [x] Dashboard displays view count, unique visitors (30d), and top referrer for public pages
- [x] Shell passes `document.referrer` via `X-Referrer` header on public page fetch
- [x] Analytics recorder uses buffered channel + worker pool (not unbounded goroutines)
- [x] Recorder drains gracefully on server shutdown
- [x] Private pages have no analytics (E2E encrypted, server can't see them)
- [x] No latency impact on public page serving

## Technical Considerations

### Cloudflare Cache Interaction

The public page handler sets `Cache-Control: public, s-maxage=60`. If the API is behind a CDN, cached responses won't trigger analytics recording. For v1, this is acceptable -- analytics will be approximate (one origin hit per cache TTL). If accurate counts matter later, options include:
- Removing the cache header (trades performance for accuracy)
- Adding a client-side beacon from shell.html
- Using Cloudflare Analytics API

### Owner's Own Views

Owner visits to their own public pages will be counted. Filtering owner views from an unauthenticated endpoint is architecturally complex (the public endpoint has no auth). This is a known v1 limitation. Could add an "exclude my IP" toggle later.

### Singleflight Interaction

If singleflight request coalescing is later added to the public page handler, analytics recording must happen BEFORE the singleflight boundary (at the HTTP handler level) so each individual request is counted, not just the coalesced one.

### Data Retention

No retention policy for v1. Table grows with traffic. For a page with 1000 views/day, that's ~365K rows/year -- manageable. Can add partitioning or rollup later if needed.

### Page Identity

Pages exist only on the agent filesystem. Analytics references `(user_id, slug)` loosely. If a page is deleted and recreated with the same slug, old analytics merge. This is acceptable for v1.

## Files Summary

| File | Action |
|------|--------|
| `migrations/011_create_page_views.sql` | **Create** -- new table |
| `api/internal/analytics/recorder.go` | **Create** -- async recorder with worker pool |
| `api/internal/storage/postgres.go` | **Modify** -- add `InsertPageView`, `GetPageAnalytics` |
| `api/internal/models/models.go` | **Modify** -- add `PageAnalytics`, `Referrer` structs |
| `api/cmd/server/main.go` | **Modify** -- init recorder, record in public handler, add analytics endpoint |
| `web/public/p/shell.html` | **Modify** -- add `X-Referrer` header to public page fetch |
| `web/src/lib/api.ts` | **Modify** -- add `PageAnalytics` interface and `getPageAnalytics()` |
| `web/src/pages/dashboard.ts` | **Modify** -- display inline analytics for public pages |

## Dependencies & Risks

- **Depends on**: Public pages feature (already shipped on `feat/public-pages` branch)
- **Risk**: Under viral load, channel buffer could fill and drop events. Acceptable for v1 -- analytics is best-effort, not billing-critical.
- **Risk**: No referrer data from privacy-strict browsers (Brave, Firefox strict mode). Expected -- referrer field will be empty for these visitors.

## References

- Public pages plan: `docs/plans/2026-03-06-feat-public-pages-plan.md`
- Public page handler: `api/cmd/server/main.go:246-305`
- Dashboard page list: `web/src/pages/dashboard.ts:164-196`
- API client: `web/src/lib/api.ts:55-84`
- Shell public fetch: `web/public/p/shell.html:103-110`
- Migration pattern: `migrations/010_drop_pages_table.sql`

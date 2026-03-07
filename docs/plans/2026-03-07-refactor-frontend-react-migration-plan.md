---
title: "refactor: Migrate Frontend from Vanilla TypeScript to React"
type: refactor
status: completed
date: 2026-03-07
---

# refactor: Migrate Frontend from Vanilla TypeScript to React

## Overview

Migrate the yourbro frontend from vanilla TypeScript (template literals + innerHTML + manual event binding) to React with proper component architecture. The current codebase is ~1,500 lines across 7 source files, with `dashboard.ts` alone at 759 lines containing ~10 logical components. The migration adds React + React Router on top of the existing Vite build, keeps `lib/` files unchanged, and leaves `shell.html`/`page-sw.js` as vanilla JS.

## Problem Statement / Motivation

The dashboard file has grown to 759 lines with tightly coupled concerns: SSE connections, E2E crypto operations, pairing state, page listing, analytics modals, and token management. The vanilla TS pattern of `innerHTML` + `querySelectorAll` + `addEventListener` makes it hard to:

- Reason about state flow (module-level mutable `pairingCache`, `activeSSE`)
- Add new features without growing files further
- Reuse UI patterns (each modal, form, list is hand-wired)
- Handle component lifecycle (SSE cleanup, event listener removal)

React's component model, hooks, and declarative rendering directly solve these problems.

## Proposed Solution

### Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | React (full) | User preference, ecosystem, component model |
| Build tool | Vite + `@vitejs/plugin-react` | Minimal change to existing Vite setup |
| Router | `react-router-dom` (HashRouter) | Matches existing hash-based routing |
| Shell files | Stay vanilla JS | Separate concern, no React benefit |
| CSS approach | Inline styles initially, extract later | Fastest migration path |
| Lib files | Unchanged | Already framework-agnostic |

### Architecture

```
web/src/
  main.tsx                    # React entry point (replaces main.ts)
  App.tsx                     # HashRouter + routes
  components/
    RequireAuth.tsx            # Auth guard wrapper
    DashboardHeader.tsx        # Logo, email, how-to-use, logout
    PageCard.tsx               # Single page item with analytics/delete buttons
    PagesList.tsx              # Pages section (fetches pages + analytics)
    PairedAgentsList.tsx       # Paired agents with remove
    AvailableAgentsList.tsx    # Unpaired agents with pair form
    AgentsGrid.tsx             # Two-column agents layout
    TokensSection.tsx          # Token list + create + revoke
    AnalyticsModal.tsx         # Portal-based analytics popup
  hooks/
    useAuth.ts                 # getMe(), isLoggedIn(), logout()
    useAgentStream.ts          # SSE EventSource → agents[] state
    usePairingStatus.ts        # Probe agents, manage pairing cache
    usePages.ts                # Fetch pages via relay from paired agent
    useTokens.ts               # CRUD for API tokens
  pages/
    LoginPage.tsx              # Landing/login (static content)
    DashboardPage.tsx          # Composes all dashboard components
    HowToUsePage.tsx           # How-to-use (static content)
    OAuthCallback.tsx          # Handles /callback redirect
  lib/
    api.ts                     # UNCHANGED
    crypto.ts                  # UNCHANGED
    e2e.ts                     # UNCHANGED
```

## Technical Approach

### Phase 1: Build Setup

Add React dependencies and configure Vite.

**`web/package.json`** — add dependencies:
```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.4.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

**`web/vite.config.ts`** — add React plugin:
```typescript
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // ... existing proxy config
});
```

**`web/tsconfig.json`** — add JSX support:
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    // ... existing options
  }
}
```

**`web/index.html`** — change entry from `main.ts` to `main.tsx`:
```html
<script type="module" src="/src/main.tsx"></script>
```

- [x] Add `react`, `react-dom`, `react-router-dom` to package.json
- [x] Add `@vitejs/plugin-react`, `@types/react`, `@types/react-dom` to devDependencies
- [x] Update `vite.config.ts` with React plugin
- [x] Update `tsconfig.json` with `"jsx": "react-jsx"`
- [x] Update `index.html` entry to `main.tsx`
- [x] Verify build works via Docker Compose

### Phase 2: Entry Point + Router

Replace `main.ts` with React entry and router.

**`web/src/main.tsx`**:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

**`web/src/App.tsx`**:
```tsx
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HowToUsePage } from "./pages/HowToUsePage";
import { OAuthCallback } from "./pages/OAuthCallback";
import { RequireAuth } from "./components/RequireAuth";

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/callback" element={<OAuthCallback />} />
        <Route path="/how-to-use" element={<HowToUsePage />} />
        <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
```

**`web/src/components/RequireAuth.tsx`**:
```tsx
import { Navigate } from "react-router-dom";
import { isLoggedIn } from "../lib/api";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [x] Create `main.tsx` with React root
- [x] Create `App.tsx` with HashRouter and routes
- [x] Create `RequireAuth.tsx` auth guard
- [x] Create `OAuthCallback.tsx` (port callback logic from main.ts)
- [x] Delete old `main.ts`

### Phase 3: Static Pages (LoginPage, HowToUsePage)

Convert the two static pages. These are straightforward JSX conversions — template literals become JSX, inline styles become `style={{}}` objects.

**`web/src/pages/LoginPage.tsx`** — port from `login.ts` (103 lines):
- Hero section, How It Works, Key Features, Bottom CTA
- Google sign-in `<a>` remains a plain link
- Replace `onmouseover`/`onmouseout` with CSS `:hover` or React event handlers

**`web/src/pages/HowToUsePage.tsx`** — port from `how-to-use.ts` (143 lines):
- Conditional Dashboard/Sign-In link uses `isLoggedIn()`
- SVG icons become inline JSX (or extracted to a small icons file)

- [x] Create `LoginPage.tsx` from `login.ts`
- [x] Create `HowToUsePage.tsx` from `how-to-use.ts`
- [x] Delete old `login.ts` and `how-to-use.ts`

### Phase 4: Custom Hooks

Extract the imperative state management into React hooks.

**`web/src/hooks/useAuth.ts`**:
```typescript
// Wraps getMe(), isLoggedIn(), logout()
// Returns { user, loading, error, logout }
// Calls getMe() on mount, redirects to "/" on 401
```

**`web/src/hooks/useAgentStream.ts`**:
```typescript
// Manages SSE EventSource to /api/agents/stream
// Returns { agents: Agent[], connected: boolean }
// Cleanup on unmount (replaces module-level activeSSE + hashchange listener)
// Fallback to REST listAgents() on SSE error
```

**`web/src/hooks/usePairingStatus.ts`**:
```typescript
// Replaces module-level pairingCache Map
// Probes online agents via probeAgentPairing()
// Returns { getPairingStatus(id), pairAgent(id, code), removeAgent(id) }
// Triggers re-probe when agents list changes
```

**`web/src/hooks/usePages.ts`**:
```typescript
// Fetches pages via relay from first paired online agent
// Fetches analytics in parallel
// Returns { pages, analytics, loading, deletePage(slug) }
```

**`web/src/hooks/useTokens.ts`**:
```typescript
// CRUD wrapper: listTokens, createToken, deleteToken
// Returns { tokens, loading, createToken(name), deleteToken(id), newlyCreated }
```

- [x] Create `useAuth.ts`
- [x] Create `useAgentStream.ts` (SSE + cleanup)
- [x] Create `usePairingStatus.ts` (replaces pairingCache)
- [x] Create `usePages.ts` (relay + analytics)
- [x] Create `useTokens.ts`

### Phase 5: Dashboard Components

Break `dashboard.ts` (759 lines) into focused components.

**`web/src/pages/DashboardPage.tsx`** — orchestrator (~60 lines):
```tsx
// Uses useAuth, useAgentStream, usePairingStatus, usePages, useTokens
// Composes: DashboardHeader, PagesList, AgentsGrid, TokensSection, AnalyticsModal
// Includes the dashboard <style> block (or CSS module)
```

**`web/src/components/DashboardHeader.tsx`** (~30 lines):
- Logo, email, How-to-Use link, Logout button

**`web/src/components/PagesList.tsx`** (~80 lines):
- Maps pages to `<PageCard>` components
- Shows loading/empty states

**`web/src/components/PageCard.tsx`** (~40 lines):
- Title link, public badge, stats text
- Analytics button (public only), Delete button

**`web/src/components/AgentsGrid.tsx`** (~20 lines):
- Two-column grid wrapper

**`web/src/components/PairedAgentsList.tsx`** (~50 lines):
- Online/offline dot, agent name, remove button

**`web/src/components/AvailableAgentsList.tsx`** (~60 lines):
- Pairing code input, pair button, status feedback

**`web/src/components/TokensSection.tsx`** (~70 lines):
- Token list with revoke, create button, new token display

**`web/src/components/AnalyticsModal.tsx`** (~120 lines):
- React Portal to `document.body`
- Summary stats, daily views bar chart, top referrers table
- Close on X, overlay click, Escape key
- Scoped CSS classes (existing `yb-modal-*` pattern)

- [x] Create `DashboardPage.tsx` (orchestrator)
- [x] Create `DashboardHeader.tsx`
- [x] Create `PagesList.tsx` + `PageCard.tsx`
- [x] Create `AgentsGrid.tsx`
- [x] Create `PairedAgentsList.tsx`
- [x] Create `AvailableAgentsList.tsx`
- [x] Create `TokensSection.tsx`
- [x] Create `AnalyticsModal.tsx` (Portal)
- [x] Delete old `dashboard.ts`

### Phase 6: Cleanup + Build Verification

- [x] Remove all old `.ts` page files
- [x] Update any imports
- [x] Verify `npm run build` works (via Docker Compose)
- [ ] Test all routes: `/`, `/callback`, `/how-to-use`, `/dashboard`
- [ ] Test SSE real-time agent status
- [ ] Test pairing flow
- [ ] Test page list + analytics modal
- [ ] Test token CRUD
- [ ] Test logout
- [ ] Verify `web-deploy.yml` still works (build command unchanged: `npm ci && npm run build`)

## Acceptance Criteria

- [x] React 19 + React Router 7 running on Vite with `@vitejs/plugin-react`
- [x] Hash-based routing preserved (existing URLs like `/#/dashboard` still work)
- [x] Dashboard split into 9+ focused components (none over 120 lines)
- [x] SSE connection managed by `useAgentStream` hook with proper cleanup
- [x] Pairing cache moved from module-level Map to React state
- [x] Analytics modal uses React Portal
- [x] All `lib/` files unchanged (api.ts, crypto.ts, e2e.ts)
- [x] `shell.html` and `page-sw.js` unchanged (vanilla JS)
- [ ] No functionality regressions
- [x] Builds via Docker Compose
- [x] GitHub Actions deploy workflow works without changes

## Technical Considerations

### CSS Strategy

For v1, keep inline styles as React `style={{}}` objects. The existing `<style>` blocks (dashboard layout, modal) can either:
- Stay as injected `<style>` elements (works but not idiomatic React)
- Move to CSS modules (`.module.css` files — Vite supports these out of the box)
- **Recommendation**: Use CSS modules for shared styles, inline for one-off styling

The documented issue with modal inline styles being overridden (see `docs/solutions/ui-bugs/analytics-modal-inline-styles-overridden.md`) is solved naturally by React Portal + CSS modules.

### Color Palette

The project uses a consistent GitHub Dark palette (documented in `docs/solutions/ui-bugs/landing-page-redesign-and-color-scheme.md`):

```
Body: #0d1117, Surface: #161b22, Border: #30363d
Text: #e6edf3, Secondary: #8b949e, Muted: #656d76
Link: #58a6ff, Success: #3fb950, Danger: #f85149
Button: #21262d
```

Consider extracting these to CSS custom properties or a shared constants file during migration.

### SSE Lifecycle

The current SSE pattern uses module-level `activeSSE` and cleans up on `hashchange`. In React, this becomes a `useEffect` with cleanup:

```typescript
useEffect(() => {
  const sse = new EventSource(`${API_BASE}/api/agents/stream`, { withCredentials: true });
  sse.onmessage = (e) => setAgents(JSON.parse(e.data));
  return () => sse.close();
}, []);
```

This is cleaner and prevents the leak-prone manual cleanup pattern.

### Browser Dialogs

The current code uses `confirm()` for deletions and `prompt()` for token names. These work in React but are blocking and non-customizable. Keep them for v1 — replace with custom modals later if desired.

### Build Command

The GitHub Actions workflow runs `tsc && vite build`. With React JSX, `tsc` needs `--noEmit` since Vite handles the actual compilation. Update the `build` script in `package.json`:

```json
"build": "tsc --noEmit && vite build"
```

### Cloudflare Transform Rules

Existing rules serve `index.html` for SPA routes. React's build output is the same structure (`dist/index.html` + `dist/assets/`), so no Transform Rule changes needed. The `/p/*` exclusion for `.js`, `.css`, `.json` extensions continues to work.

## Dependencies & Risks

- **Risk**: React 19 is the latest major version. If any compatibility issues arise with react-router-dom v7, fall back to v6.
- **Risk**: The Docker multi-stage build installs `npm ci` — adding React dependencies increases the `node_modules` size but doesn't affect the final Docker image (frontend builds to static files).
- **Risk**: SSE reconnection logic must be carefully ported to avoid connection leaks.
- **Depends on**: All current features working (analytics modal fix should be deployed first).

## Files Summary

| File | Action |
|------|--------|
| `web/package.json` | **Modify** — add React, React Router, plugin deps |
| `web/vite.config.ts` | **Modify** — add React plugin |
| `web/tsconfig.json` | **Modify** — add `jsx: "react-jsx"` |
| `web/index.html` | **Modify** — change entry to `main.tsx` |
| `web/src/main.ts` | **Delete** — replaced by `main.tsx` |
| `web/src/main.tsx` | **Create** — React entry point |
| `web/src/App.tsx` | **Create** — Router + routes |
| `web/src/components/RequireAuth.tsx` | **Create** |
| `web/src/pages/OAuthCallback.tsx` | **Create** |
| `web/src/pages/LoginPage.tsx` | **Create** — replaces `login.ts` |
| `web/src/pages/login.ts` | **Delete** |
| `web/src/pages/HowToUsePage.tsx` | **Create** — replaces `how-to-use.ts` |
| `web/src/pages/how-to-use.ts` | **Delete** |
| `web/src/pages/DashboardPage.tsx` | **Create** — replaces `dashboard.ts` |
| `web/src/pages/dashboard.ts` | **Delete** |
| `web/src/hooks/useAuth.ts` | **Create** |
| `web/src/hooks/useAgentStream.ts` | **Create** |
| `web/src/hooks/usePairingStatus.ts` | **Create** |
| `web/src/hooks/usePages.ts` | **Create** |
| `web/src/hooks/useTokens.ts` | **Create** |
| `web/src/components/DashboardHeader.tsx` | **Create** |
| `web/src/components/PagesList.tsx` | **Create** |
| `web/src/components/PageCard.tsx` | **Create** |
| `web/src/components/AgentsGrid.tsx` | **Create** |
| `web/src/components/PairedAgentsList.tsx` | **Create** |
| `web/src/components/AvailableAgentsList.tsx` | **Create** |
| `web/src/components/TokensSection.tsx` | **Create** |
| `web/src/components/AnalyticsModal.tsx` | **Create** |
| `web/src/lib/api.ts` | **Unchanged** |
| `web/src/lib/crypto.ts` | **Unchanged** |
| `web/src/lib/e2e.ts` | **Unchanged** |
| `web/public/p/shell.html` | **Unchanged** |
| `web/public/p/page-sw.js` | **Unchanged** |

## References

- Current router: `web/src/main.ts:1-47`
- Dashboard (largest file): `web/src/pages/dashboard.ts:1-759`
- Login page: `web/src/pages/login.ts:1-103`
- How-to-use page: `web/src/pages/how-to-use.ts:1-143`
- API client: `web/src/lib/api.ts:1-174`
- Crypto lib: `web/src/lib/crypto.ts:1-121`
- E2E lib: `web/src/lib/e2e.ts:1-106`
- Vite config: `web/vite.config.ts:1-15`
- Build workflow: `.github/workflows/web-deploy.yml`
- Modal CSS gotcha: `docs/solutions/ui-bugs/analytics-modal-inline-styles-overridden.md`
- Color palette: `docs/solutions/ui-bugs/landing-page-redesign-and-color-scheme.md`
- SSE patterns: `docs/solutions/integration-issues/sse-real-time-dashboard-agent-status.md`

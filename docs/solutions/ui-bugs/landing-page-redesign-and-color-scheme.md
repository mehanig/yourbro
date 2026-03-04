---
title: "How to Use Landing Page and App-Wide Color Scheme Redesign"
date: 2026-03-05
category: ui-bugs
tags:
  - color-scheme
  - landing-page
  - design-system
  - typescript-build
  - product-accuracy
  - visual-design
severity: medium
component: "Frontend (web/src/pages/, web/index.html, web/tsconfig.json)"
symptom: |
  1. No onboarding or documentation page — users had no way to learn about the product
  2. Inconsistent, unprofessional color scheme with ad-hoc hex values (purple-tinted buttons, neon green, harsh white on pure black)
  3. TypeScript build failed due to test files included in tsc compilation
  4. Product descriptions incorrectly stated data is stored "on your machine" instead of on ClawdBot itself
  5. How to Use page was a wall of text with no visual hierarchy
root_cause: |
  Initial development prioritized core functionality over documentation, design consistency, and build configuration. tsconfig.json had no exclude directive, so test files with type incompatibilities broke production builds. Product messaging didn't accurately reflect ClawdBot's storage architecture.
resolution: |
  Created a visually engaging How to Use page with cards, SVG icons, step numbers, and grid layouts. Applied a GitHub Dark-inspired color palette consistently across the entire app. Excluded test files from tsc. Corrected all product descriptions to accurately describe ClawdBot's data storage model.
---

## Problem

The yourbro web app had five interrelated issues:

1. **No onboarding page** — only login and dashboard views existed
2. **Ad-hoc color scheme** — inconsistent dark theme with purple-tinted buttons (`#1a1a2e`), neon green (`#4ade80`), harsh white (`#fafafa`) on pure black (`#0a0a0a`)
3. **Build failure** — `tsc` compiled test files (`crypto.test.ts`) that had `Uint8Array`/`BufferSource` type incompatibilities
4. **Incorrect product descriptions** — stated data lives "on your machine" when it actually lives on ClawdBot itself
5. **Boring How to Use page** — initial implementation was a plain wall of text

## Solution

### 1. How to Use Page (`web/src/pages/how-to-use.ts`)

Created `renderHowToUse(container: HTMLElement)` with visual design techniques:

- **Hero section** with gradient background and blue accent line
- **Two-column card grid** for "What is yourbro" / "What is ClawdBot"
- **Numbered step cards** with styled badges for Getting Started (1–4)
- **Code-style monospace callouts** for technical architecture flows
- **2x2 grid layout** for Security features
- **Inline SVG icons** (Lucide-style) — no emojis per user preference

### 2. Route Setup (`web/src/main.ts`)

Added `#/how-to-use` route **before** the auth check so it works for unauthenticated users:

```typescript
// Public routes (no auth required)
if (hash === "#/how-to-use") {
  renderHowToUse(app);
  return;
}

// Handle OAuth callback
if (hash.startsWith("#/callback")) { ... }

// Auth-required routes below
if (!isLoggedIn()) { ... }
```

### 3. Color Scheme — GitHub Dark Palette

Replaced all ad-hoc colors with a consistent palette across `index.html`, `login.ts`, `dashboard.ts`, and `how-to-use.ts`:

| Role | Old | New |
|------|-----|-----|
| Body background | `#0a0a0a` | `#0d1117` |
| Primary text | `#fafafa` | `#e6edf3` |
| Surface/cards | `#111` | `#161b22` |
| Borders | `#222`, `#333` | `#30363d` |
| Secondary text | `#888` | `#8b949e` |
| Muted text | `#666`, `#555` | `#656d76` |
| Links | `#60a5fa` | `#58a6ff` |
| Success | `#4ade80` | `#3fb950` |
| Danger | `#f88` | `#f85149` |
| Warning | `#fbbf24` | `#d29922` |
| Button surface | `#1a1a2e` (purple!) | `#21262d` |
| Danger bg | `#300` | `#2d1214` |
| Success bg | `#0a1a0a` | `#0f1a10` |

### 4. Build Fix (`web/tsconfig.json`)

```json
{
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Tests continue to work via vitest, which handles its own TypeScript compilation.

### 5. Corrected Product Descriptions

**Wrong:** "stores data on your machine"
**Correct:** "stores data in ClawdBot's own SQLite database"

The architecture is:
```
Browser → yourbro (thin HTML) → SDK fetches data from ClawdBot → rendered in browser
```

ClawdBot publishes thin HTML pages. yourbro renders them. The yourbro SDK embedded in those pages fetches data directly from ClawdBot. yourbro servers never see user data.

## Files Modified

| File | Change |
|------|--------|
| `web/src/pages/how-to-use.ts` | **Created** — full How to Use page with visual design |
| `web/src/main.ts` | Added `#/how-to-use` route, imported `renderHowToUse` |
| `web/src/pages/login.ts` | Added "How to Use" link, updated colors |
| `web/src/pages/dashboard.ts` | Added "How to Use" link in header, updated all colors |
| `web/index.html` | Updated body background and text color |
| `web/tsconfig.json` | Added `exclude` for test files |
| `CLAUDE.md` | **Created** — documents Docker Compose build requirement |

## Prevention Strategies

- **Centralize colors**: Consider extracting the palette into CSS custom properties in `index.html` rather than repeating hex values in every inline style. This makes future palette changes a single-file edit.
- **Exclude test files by default**: Any new TypeScript project should have `"exclude": ["**/*.test.ts", "**/*.spec.ts"]` in tsconfig from day one.
- **Documentation accuracy**: Product descriptions should be reviewed by engineers who built the feature. The data flow (ClawdBot stores data, SDK fetches from ClawdBot) is a core architectural fact that should be stated consistently.
- **Visual design from the start**: Use cards, grids, and visual hierarchy for any user-facing content page — walls of text don't engage users.

## Related Documentation

- [Sandboxed Iframe SDK Delivery](../integration-issues/sandboxed-iframe-sdk-delivery-with-keypair-relay.md) — SDK architecture, Ed25519 key management
- [SSE Real-Time Dashboard](../integration-issues/sse-real-time-dashboard-agent-status.md) — dashboard agent status updates
- [Agent Key Revocation](../security-issues/incomplete-agent-key-revocation-on-removal.md) — agent pairing/unpairing flow
- [Go Regex Backreference Collision](../logic-errors/go-regex-backreference-collision-with-js-template-literals.md) — template literal handling

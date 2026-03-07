---
title: "fix: Public pages broken in in-app browsers (Telegram, Instagram WebView)"
type: fix
status: active
date: 2026-03-07
---

# Fix: Public Pages Broken In-App Browsers (Service Worker Fallback)

## Problem

Public pages (e.g. `yourbro.ai/p/mehanig/demo`) show "This page is not available" when opened in in-app browsers like Telegram or Instagram on iPhone. The same pages work fine in Safari, Chrome, and even incognito mode.

## Root Cause

The page shell (`web/public/p/shell.html`) **completely depends on Service Workers** to serve page content. The flow is:

1. Shell fetches page data from `/api/public-page/{username}/{slug}` (JSON with file bundle) -- **this works fine everywhere**
2. Shell sends files to Service Worker via `postMessage` for caching
3. Shell creates `<iframe src="/p/assets/{slug}/index.html">`
4. Service Worker intercepts the iframe fetch and serves from cache

**In-app browsers (WebViews) do not support Service Workers.** So:
- Step 2 fails silently (`swReady` is `null`, the caching block is skipped)
- Step 3 still creates the iframe pointing to `/p/assets/{slug}/index.html`
- Step 4 never happens -- no SW to intercept the request
- The browser makes a real network request to `/p/assets/{slug}/index.html` which **doesn't exist on the server**
- Result: blank iframe, user sees nothing

**Why incognito works but WebViews don't:** Incognito browsers fully support Service Workers (they just don't persist cache between sessions). WebViews run in a restricted `WKWebView` sandbox that often disables SW registration entirely.

### Code locations

| Issue | File | Lines |
|-------|------|-------|
| SW registration (soft-fails) | `web/public/p/shell.html` | 39-57 |
| SW caching via postMessage | `web/public/p/shell.html` | 60-83 |
| Iframe src = SW-only URL | `web/public/p/shell.html` | ~89 |
| SW fetch handler (no network fallback) | `web/public/p/page-sw.js` | 82-95 |

## Solution

Add a **blob URL fallback** in `renderPage()` when Service Workers are unavailable. Instead of setting `iframe.src` to a SW-cached URL, inject the HTML directly via a blob URL.

### Technical Approach

**File: `web/public/p/shell.html`**

The `renderPage()` function currently always sets `iframe.src = '/p/assets/' + slug + '/index.html'`. Change it to:

1. If Service Worker is available and caching succeeded: use current SW path (unchanged)
2. If Service Worker is NOT available: construct a blob URL from the page data and set `iframe.src` to it

```javascript
async function renderPage(pageData) {
    var swCached = false;

    // Try SW caching (existing code)
    if (swReady) {
        try {
            var reg = await swReady;
            var sw = reg.active;
            if (sw) {
                await new Promise(function(resolve) {
                    var channel = new MessageChannel();
                    channel.port1.onmessage = function() { resolve(); };
                    sw.postMessage({
                        type: 'cache-page',
                        slug: slug,
                        files: pageData.files
                    }, [channel.port2]);
                });
                swCached = true;
            }
        } catch(e) {
            console.warn('SW caching failed:', e);
        }
    }

    var container = document.createElement('div');
    container.className = 'frame-container';
    var iframe = document.createElement('iframe');

    if (swCached) {
        // Service Worker will serve from cache
        iframe.src = '/p/assets/' + slug + '/index.html';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    } else {
        // Fallback: inject HTML directly via blob URL
        var html = pageData.files['index.html'];

        // Rewrite relative asset references to inline data URIs or blob URLs
        // For CSS: inject <style> tags
        // For JS: inject <script> tags
        // This handles the common case of index.html + inline assets
        for (var filename in pageData.files) {
            if (filename === 'index.html') continue;
            var content = pageData.files[filename];

            if (filename.endsWith('.css')) {
                // Replace <link href="filename"> with inline <style>
                html = html.replace(
                    new RegExp('<link[^>]+href=["\']' + escapeRegExp(filename) + '["\'][^>]*>', 'g'),
                    '<style>' + content + '</style>'
                );
            } else if (filename.endsWith('.js')) {
                // Replace <script src="filename"> with inline <script>
                html = html.replace(
                    new RegExp('<script[^>]+src=["\']' + escapeRegExp(filename) + '["\'][^>]*>\\s*</script>', 'g'),
                    '<script>' + content + '</script>'
                );
            }
        }

        var blob = new Blob([html], { type: 'text/html' });
        iframe.src = URL.createObjectURL(blob);
        iframe.setAttribute('sandbox', 'allow-scripts');
        // Note: no allow-same-origin for blob URLs (security)
    }

    container.appendChild(iframe);
    document.body.appendChild(container);
    return iframe;
}
```

### Key considerations

**Blob URL sandbox:** When using blob URLs, the iframe sandbox should NOT include `allow-same-origin` (the blob is already isolated). This means:
- The iframe cannot access the parent's localStorage/IndexedDB -- fine for public pages (storage bridge returns errors anyway)
- The iframe cannot access the parent's Service Worker -- fine (we're not using SW in this path)

**Asset inlining:** The blob URL approach requires inlining CSS/JS into the HTML. This is acceptable because:
- Page bundles are already sent as a single JSON response (all files in one fetch)
- Most pages have small CSS/JS files (they're already bundled by the page author)
- This is a fallback path -- users on full browsers still get the SW-cached experience

**Storage bridge for public pages:** The storage bridge already returns errors for public pages (`ok: false, error: 'Storage is not available for public pages'`). The blob URL fallback doesn't break this because:
- With blob URL, `postMessage` from iframe still works (sandbox allows `allow-scripts`)
- The shell's message listener still responds with the error
- However, with blob URL (opaque origin), `event.source` matching may need adjustment

**What NOT to change:**
- The API endpoint (`/api/public-page/{username}/{slug}`) -- works fine everywhere
- The Service Worker itself (`page-sw.js`) -- still works for capable browsers
- The E2E encrypted path (private pages) -- these require IndexedDB for keys, so they legitimately can't work in restricted browsers. Show a clear error instead.

## Edge Cases

- **Pages with external asset URLs** (not relative): These already work because the iframe fetches them directly. The blob fallback only needs to handle files in the `pageData.files` bundle.
- **Pages with images or fonts in the bundle**: These are binary and can't be inlined as text. For the fallback, we could use data URIs (`data:image/png;base64,...`) or just let them fail gracefully. Most pages use external CDN URLs for images.
- **Storage bridge with blob origin**: `event.source === iframe.contentWindow` still works for blob URLs. The `event.origin` will be `"null"` but we already handle null origins.

## Acceptance Criteria

- [ ] Public pages load in Telegram in-app browser (iPhone)
- [ ] Public pages load in Instagram in-app browser (iPhone)
- [ ] Public pages still work in Safari/Chrome (SW path unchanged)
- [ ] Pages with CSS/JS assets render correctly in fallback mode
- [ ] Storage bridge responds correctly in fallback mode (returns error for public pages)
- [ ] Private pages show a clear error in browsers without IndexedDB/SW support
- [ ] No regression for E2E encrypted page loading in full browsers

## Files to Modify

| File | Change |
|------|--------|
| `web/public/p/shell.html` | Add blob URL fallback in `renderPage()`, add `escapeRegExp` helper |

## Testing

1. Open a public page in Telegram (iPhone) -- should load
2. Open same page in Safari -- should load (SW path)
3. Open same page in Chrome incognito -- should load (SW path)
4. Disable Service Workers in Chrome DevTools, reload public page -- should load (blob fallback)
5. Check page with CSS/JS assets renders correctly in both paths

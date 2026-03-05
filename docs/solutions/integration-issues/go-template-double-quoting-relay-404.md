---
title: "Go template %q verb causes double-quoting in JS context, breaking relay page requests"
category: integration-issues
tags:
  - go-templates
  - html-template
  - javascript
  - string-escaping
  - relay
  - chi-router
module: api/handlers/pages
symptom: "Relay pages show 'agent offline' even though agent is online; agent logs show 404 for page GET requests"
root_cause: "Using {{printf \"%q\" .Slug}} inside a JavaScript string literal adds quotes twice — %q adds quotes, and the surrounding JS already has quotes"
date: 2026-03-05
---

# Go Template %q Double-Quoting Breaks Relay Page Requests

## Symptom

After implementing zero-knowledge relay pages, visiting `/p/{username}/{slug}` showed "Your agent is currently offline" even though:
- The agent was connected via WebSocket (SSE showed it as online)
- `GET /api/pages` via relay returned 200 with the page list
- `GET /api/page/hello` via curl with Bearer token returned 200 with full content

The agent logs showed 404 for the page GET request coming through the relay.

## Investigation

1. **Verified agent online**: Direct relay calls to `GET /api/pages` returned 200 with page data
2. **Verified page exists**: `GET /api/page/hello` via curl returned the full page content
3. **Checked agent logs**: `"GET https://relay.internal HTTP/1.1" from - 404` (chi logger doesn't show full path for programmatic `httptest` requests)
4. **Rebuilt agent container**: Initially suspected stale image missing page routes — rebuilt, but GET still 404'd (PUT and LIST worked)
5. **Inspected rendered HTML**: The smoking gun:
   ```bash
   curl -s http://localhost/p/mehanig/hello | grep "var slug"
   ```
   Output: `var slug = "\"hello\"";`

   The slug contained literal quote characters inside the JavaScript string.

## Root Cause

In `api/internal/handlers/pages.go`, the Go template injected the slug into JavaScript using:

```go
var slug = {{printf "%q" .Slug}};
```

Go's `fmt` `%q` verb wraps the string in double quotes AND escapes internal quotes. But the JavaScript already had surrounding quotes. The template rendered as:

```javascript
// What was rendered:
var slug = "\"hello\"";

// What was expected:
var slug = "hello";
```

The relay request path became `/api/page/"hello"` (or `/api/page/%22hello%22`) instead of `/api/page/hello`. The agent's chi router couldn't match this path, returning 404.

## Fix

**Before:**
```go
var slug = {{printf "%q" .Slug}};
```

**After:**
```go
var slug = "{{.Slug}}";
```

Go's `html/template` package includes context-aware escaping. When a value appears inside a `<script>` block between JavaScript string quotes, the template engine automatically escapes special characters for JS safety without adding extra quotes.

## Why This Was Hard to Find

- The chi logger for `httptest` requests logs `r.URL.String()` which showed `https://relay.internal` without the path — making it look like all requests hit the same URL
- The 404 looked identical to "agent offline" because the shell JS treats any non-200 relay response as "agent offline"
- Other relay operations (PUT for page creation, GET for page list) worked fine because they didn't go through the template slug injection
- The double-quoting is subtle in the HTML source — you have to specifically grep for the variable to notice it

## Prevention

### When injecting Go template values into JavaScript

| Context | Approach | Example |
|---------|----------|---------|
| JS string literal | Plain interpolation | `var x = "{{.Value}}";` |
| JS numeric | Plain interpolation | `var x = {{.Value}};` |
| Go string repr | `%q` | `{{printf "%q" .Value}}` |
| JSON data block | `json.Marshal` + `template.JS` | `var data = {{.DataJSON}};` |

**Rule**: Never use `%q` inside `<script>` blocks. Use plain `"{{.Value}}"` and let `html/template` handle context-aware escaping.

### Verification

After changing any Go template that injects values into JavaScript, verify the rendered output:

```bash
curl -s http://localhost/p/{username}/{slug} | grep "var slug"
# Expected: var slug = "hello";
# Bad:      var slug = "\"hello\"";
```

## Related

- `docs/solutions/logic-errors/go-regex-backreference-collision-with-js-template-literals.md` — Similar pattern: Go treating dynamic content as template syntax
- `docs/solutions/integration-issues/relay-router-tls-scheme-mismatch-401.md` — Another relay path construction issue (different root cause)
- `api/internal/handlers/pages.go` — The template that was fixed

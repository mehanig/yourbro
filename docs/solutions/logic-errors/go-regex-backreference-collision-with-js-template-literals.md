---
title: "Go regex ReplaceAllString silently corrupts JavaScript ${...} template literals"
category: logic-errors
tags:
  - go
  - regexp
  - ReplaceAllString
  - ReplaceAllStringFunc
  - template-literal
  - CSP-nonce
  - silent-corruption
module: server/pages
symptom: >
  Inlined JavaScript SDK source is silently corrupted — ${nonce} variable
  references disappear from the output HTML. No error, no panic, no log.
root_cause: >
  Go's regexp.ReplaceAllString treats ${name} in the replacement string as a
  named capture group backreference. When the SDK JavaScript contains ${nonce}
  as a template literal, Go expands it to empty string (no such capture group).
date: 2026-03-04
---

# Go regex ReplaceAllString corrupts JavaScript template literals

## Symptom

After wiring up inline SDK injection, pages with agent endpoints rendered broken JavaScript. The SDK's `${nonce}` variable references (JavaScript template literals) silently disappeared from the HTML output. No Go error, no panic, no log — just corrupted JavaScript served to the browser.

## Root Cause

The `addNonceToScripts` function used `regexp.ReplaceAllString` with capture group backreferences:

```go
// BROKEN — do not use
func addNonceToScripts(html, nonce string) string {
    nonceAttr := ` nonce="` + nonce + `"`
    return scriptTagRe.ReplaceAllString(html, `$1`+nonceAttr+`$2`)
}
```

Go's `regexp.ReplaceAllString` treats the replacement string as a **template** where:
- `$1`, `$2` → numbered capture groups
- `${name}` → named capture groups

The SDK's bundled JavaScript contained template literals like:

```javascript
const sigParams = `${coveredComponents};created=${created};nonce="${nonce}"`;
```

When `ReplaceAllString` processed the full HTML (which included the inlined SDK), any `${nonce}` in the text was interpreted as a backreference to a capture group named `nonce`. No such group exists, so Go expanded it to an **empty string** — silently deleting the JavaScript variable reference.

## Solution

Switch from `ReplaceAllString` to `ReplaceAllStringFunc`. The callback receives the raw match and returns a plain string — **no template expansion**:

```go
// api/internal/handlers/pages.go
var scriptTagRe = regexp.MustCompile(`(?i)(<script)([\s>])`)

func addNonceToScripts(html, nonce string) string {
    nonceAttr := ` nonce="` + nonce + `"`
    return scriptTagRe.ReplaceAllStringFunc(html, func(match string) string {
        // match[:7] is "<script", match[7:] is the trailing space or ">"
        return match[:7] + nonceAttr + match[7:]
    })
}
```

String slicing on the match itself replaces capture group backreferences entirely. No `$` interpretation happens.

## Key Insight

`ReplaceAllString` is only safe when the replacement string is a **static literal** fully controlled by your code. The moment any dynamic content enters the replacement — user input, bundled source code, config values — use `ReplaceAllStringFunc` instead.

The bug is especially dangerous because:
- **Silent** — no error, no panic, no warning
- **Conditional** — only triggers when the processed text happens to contain `${...}` or `$1`-style patterns
- **Hard to reproduce** — the corruption only appears in the HTTP response body, not in any server-side data

## Prevention

- **Use `ReplaceAllStringFunc` for any replacement involving dynamic content.** The callback returns a plain string with zero template interpretation.
- **Escape `$` as `$$` if you must use `ReplaceAllString`** — `strings.ReplaceAll(repl, "$", "$$")` before passing to the regex.
- **Never process inlined JavaScript with regex backreferences** — JS template literals (`${...}`) are ubiquitous and will collide with Go's replacement syntax.
- **Write tests with `${}` in input** — specifically test strings containing `$1`, `${name}`, and `$$` to catch backreference expansion bugs.

## Related

- [Go regexp.ReplaceAllString docs](https://pkg.go.dev/regexp#Regexp.ReplaceAllString) — "In the replacement, $ signs are interpreted as in Expand"
- [Go regexp.ReplaceAllStringFunc docs](https://pkg.go.dev/regexp#Regexp.ReplaceAllStringFunc) — no template expansion

---
title: "CGO Cross-Compilation and Skill Packaging for ClawHub/OpenClaw"
date: 2026-03-05
category: integration-issues
tags:
  - OpenClaw
  - ClawHub
  - GitHub-Actions
  - Go-build
  - CGO
  - cross-compilation
  - skill-packaging
  - binary-distribution
severity: medium
component: "skill/, agent/, .github/workflows/"
symptom: |
  1. yourbro's agent server and skill metadata were separate directories incompatible with ClawHub distribution
  2. GitHub Actions workflow attempted CGO cross-compilation for 4 platform/arch combos — fragile and unreliable
  3. Go ldflags `-X main.version=$TAG` silently did nothing because no `var version string` exists in agent code
  4. No automated release pipeline for skill package zip or agent binaries
root_cause: |
  1. skill/ had a basic SKILL.md without OpenClaw YAML frontmatter — no metadata, no installer specs, no requirements
  2. agent/ uses mattn/go-sqlite3 which requires CGO_ENABLED=1, making cross-compilation require platform-specific C toolchains
  3. Go's linker silently ignores `-X` flags for non-existent variables — no build-time validation
  4. No .clawignore or packaging mechanism to separate publishable skill files from source code
resolution: |
  1. Rewrote SKILL.md with full OpenClaw YAML frontmatter (metadata.openclaw with download installers, requires.bins, requires.env)
  2. Reduced CI build matrix to native-only: linux/amd64 on ubuntu-latest, darwin/arm64 on macos-14
  3. Removed broken `-X main.version` ldflags — version is implicit in GitHub Release tag
  4. Created .clawignore, contrib/ deployment templates, and GitHub Actions release workflow
---

## Problem

yourbro had two separate directories that couldn't be installed together on OpenClaw via ClawHub:

- **`skill/`** — Basic SKILL.md with publishing instructions + publish.sh script + empty templates/
- **`agent/`** — Full Go server (Ed25519 auth, SQLite via mattn/go-sqlite3, pairing codes, heartbeat)

Three specific issues emerged during the restructuring:

1. **No OpenClaw metadata** — SKILL.md had no YAML frontmatter, no `metadata.openclaw` block, no binary requirements or download installers
2. **CGO cross-compilation failures** — Initial GitHub Actions workflow tried to build for linux/{amd64,arm64} + darwin/{amd64,arm64} with `CGO_ENABLED=1`. Cross-compiling CGO binaries (especially linux/arm64 from amd64) requires platform-specific C cross-compilers (`gcc-aarch64-linux-gnu`) and is fragile
3. **Silent ldflags failure** — `-X main.version=${{ github.ref_name }}` was used but `agent/cmd/server/main.go` has no `var version string`, so Go silently ignores the flag

## Solution

### 1. SKILL.md with OpenClaw Frontmatter

Rewrote `skill/SKILL.md` with proper YAML frontmatter:

```yaml
---
name: yourbro
description: Publish AI-powered web pages with zero-trust agent-backed storage on yourbro.ai
user-invocable: true
metadata:
  openclaw:
    os: ["darwin", "linux"]
    homepage: "https://yourbro.ai"
    requires:
      bins: ["yourbro-agent"]
      env: ["YOURBRO_TOKEN"]
    primaryEnv: "YOURBRO_TOKEN"
    install:
      - id: download-darwin-arm64
        kind: download
        url: "https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-darwin-arm64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (macOS Apple Silicon)"
      # ... additional platform entries for darwin/amd64, linux/amd64, linux/arm64
---
```

Key elements:
- `requires.bins: ["yourbro-agent"]` — ClawHub checks for binary on PATH
- `requires.env: ["YOURBRO_TOKEN"]` — declares required environment variable
- `install` entries with `kind: download` — per-platform binary download URLs pointing to GitHub Releases

Body restructured into: overview, setup (4 steps), configuration table, usage instructions, security model, examples.

### 2. Native-Only Build Pipeline

Replaced the 4-platform CGO cross-compilation matrix with native-only builds:

```yaml
# .github/workflows/release-skill.yml
jobs:
  build-agent:
    strategy:
      matrix:
        include:
          - goos: linux
            goarch: amd64
            runner: ubuntu-latest      # Native Linux build
          - goos: darwin
            goarch: arm64
            runner: macos-14           # Native Apple Silicon build
    steps:
      - name: Build agent binary
        working-directory: agent
        env:
          CGO_ENABLED: 1               # Works because we're on native runners
        run: |
          go build -o ../yourbro-agent-${{ matrix.goos }}-${{ matrix.goarch }} ./cmd/server
```

**What was removed:**
- `linux/arm64` cross-compile (needed `gcc-aarch64-linux-gnu` + `CC` env var — fragile)
- `darwin/amd64` cross-compile (needed Intel macOS runner — `macos-13` works but adds cost)
- `-X main.version=${{ github.ref_name }}` ldflags (variable doesn't exist in code)

Additional platforms can be built manually via Docker or on target machines using `make build-agent`.

### 3. Skill Package Zip

The same workflow packages the skill directory:

```yaml
  package-skill:
    steps:
      - name: Create skill zip
        run: |
          cd skill
          zip -r ../yourbro-skill-${{ github.ref_name }}.zip \
            SKILL.md scripts/ contrib/
```

### 4. Contrib Deployment Templates

Created `skill/contrib/` with ready-to-use service files:

| File | Purpose |
|------|---------|
| `yourbro-agent.service` | Linux systemd unit with security hardening (NoNewPrivileges, ProtectSystem, PrivateTmp) |
| `com.yourbro.agent.plist` | macOS launchd with auto-restart and logging |
| `docker-compose.yml` | Containerized agent with volume persistence |
| `Dockerfile` | Multi-stage Go build for Docker users |

### 5. Package Filtering

Created `skill/.clawignore` to exclude source code, secrets, and build artifacts:

```
*.env
*.db
*.log
agent/
api/
web/
sdk/
migrations/
docs/
bin/
node_modules/
```

## Files Modified

| File | Change |
|------|--------|
| `skill/SKILL.md` | **Rewritten** — OpenClaw YAML frontmatter + restructured body |
| `skill/.clawignore` | **Created** — excludes non-skill files from publishing |
| `skill/contrib/yourbro-agent.service` | **Created** — systemd unit template |
| `skill/contrib/com.yourbro.agent.plist` | **Created** — macOS launchd plist |
| `skill/contrib/docker-compose.yml` | **Created** — containerized agent deployment |
| `skill/contrib/Dockerfile` | **Created** — multi-stage agent build |
| `.github/workflows/release-skill.yml` | **Created** — release pipeline (native builds + skill zip) |
| `skill/templates/` | **Removed** — was empty, replaced by contrib/ |

## Prevention Strategies

### CGO Cross-Compilation

- **Prefer native builds** — use platform-specific GitHub Actions runners (`macos-14` for ARM64, `ubuntu-latest` for Linux x86_64) instead of cross-compiling
- **Consider eliminating CGO** — replace `mattn/go-sqlite3` with `modernc.org/sqlite` (pure Go). This makes `CGO_ENABLED=0` cross-compilation trivial: `GOOS=X GOARCH=Y go build`
- **If CGO is required**, use Docker-based builds (zig-cc or xgo) rather than installing cross-compilers on CI runners

### Silent ldflags Failures

- **Always declare the target variable** before using `-X` ldflags:
  ```go
  // cmd/server/main.go
  var version = "dev"  // Set at build time via: -ldflags "-X main.version=v1.0.0"
  ```
- **Verify after build**: `strings yourbro-agent | grep v1.0.0` to confirm the version was embedded
- **Add a `--version` flag** and `/version` endpoint so version is observable at runtime

### Secrets Leakage in Skill Packages

- **Use .clawignore** (or equivalent) to exclude `.env`, `.key`, `.pem`, `.db` files
- **Consider whitelist approach** — explicitly list included files rather than excluding everything else
- **Rotate any tokens** that have been on disk in the repo, even if `.gitignore`d — they may exist in backups or shell history
- **CI check**: Add a step that scans the zip artifact for patterns like `yb_`, `Bearer`, `-----BEGIN` before creating the release

### Release Validation Checklist

- [ ] All platform binaries build successfully on native runners
- [ ] Skill zip contains only SKILL.md, scripts/, contrib/ (no source code, no .env)
- [ ] SHA256 checksums generated and included in release
- [ ] Binary starts and responds to `/health` endpoint
- [ ] YAML frontmatter validates against OpenClaw skill schema

## Related Documentation

- [Sandboxed Iframe SDK Delivery](../integration-issues/sandboxed-iframe-sdk-delivery-with-keypair-relay.md) — SDK bundling patterns, CSP nonces
- [SSE Real-Time Dashboard](../integration-issues/sse-real-time-dashboard-agent-status.md) — Agent heartbeat and status monitoring
- [Agent Key Revocation](../security-issues/incomplete-agent-key-revocation-on-removal.md) — Distributed agent state management
- [Go Regex Backreference Collision](../logic-errors/go-regex-backreference-collision-with-js-template-literals.md) — Go/JS interop edge cases
- [Landing Page Redesign](../ui-bugs/landing-page-redesign-and-color-scheme.md) — User-facing documentation and onboarding
- [Restructuring Plan](../../plans/2026-03-05-feat-restructure-skill-agent-for-openclaw-plan.md) — Full implementation plan with phases, alternatives, and open questions
- OpenClaw Skills docs: https://docs.openclaw.ai/tools/skills
- ClawHub docs: https://docs.openclaw.ai/tools/clawhub
- `modernc.org/sqlite` (pure-Go SQLite): https://pkg.go.dev/modernc.org/sqlite

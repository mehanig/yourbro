---
title: "Restructure skill/ and agent/ into a single ClawHub-installable OpenClaw skill"
type: feat
status: active
date: 2026-03-05
---

# Restructure skill/ and agent/ for OpenClaw Installation

## Overview

Combine the current `skill/` (SKILL.md + publish script) and `agent/` (Go server binary) into a single directory that can be installed via `clawhub install yourbro` on any OpenClaw instance. The agent binary is distributed as a pre-compiled download per platform. All secrets are provided at configuration time via OpenClaw's `openclaw.json` — nothing is baked into the package.

## Problem Statement / Motivation

Currently, setting up yourbro on OpenClaw requires:
1. Manually placing the SKILL.md in the right directory
2. Separately building/deploying the agent Go binary
3. Manually configuring environment variables in `.env` files
4. No standard installation, update, or uninstall path

Users of OpenClaw (ClawdBot) should be able to run `clawhub install yourbro` and get both the skill instructions (for the AI agent) and the data storage server (agent binary) in one step, with configuration guided through OpenClaw's standard config system.

## Proposed Solution

### Target Directory Layout

The **published skill package** (what lives in `<workspace>/skills/yourbro/` after install):

```
yourbro/
  SKILL.md                    # OpenClaw skill manifest + instructions (YAML frontmatter)
  scripts/
    publish.sh                # Page publishing helper script
  contrib/
    yourbro-agent.service     # Example systemd unit file
    com.yourbro.agent.plist   # Example macOS launchd plist
    docker-compose.yml        # Docker Compose alternative for self-hosting
    Dockerfile                # For users who prefer Docker
```

The **repo structure** (source code, not shipped in skill package):

```
yourbro/
  skill/                      # -> Published as the ClawHub skill package
    SKILL.md
    scripts/publish.sh
    contrib/
      yourbro-agent.service
      com.yourbro.agent.plist
      docker-compose.yml
      Dockerfile
  agent/                      # -> Source code for building the binary (NOT shipped)
    cmd/server/main.go
    internal/...
    go.mod, go.sum
  .clawignore                 # Excludes agent/, .env, etc. from clawhub publish
  ...rest of repo unchanged
```

### SKILL.md Frontmatter

```yaml
---
name: yourbro
description: Publish AI-powered web pages with zero-trust agent-backed storage
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
        os: darwin
        arch: arm64
      - id: download-darwin-amd64
        kind: download
        url: "https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-darwin-amd64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (macOS Intel)"
        os: darwin
        arch: amd64
      - id: download-linux-amd64
        kind: download
        url: "https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-linux-amd64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (Linux x86_64)"
        os: linux
        arch: amd64
      - id: download-linux-arm64
        kind: download
        url: "https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-linux-arm64"
        bins: ["yourbro-agent"]
        label: "Download yourbro-agent (Linux ARM64)"
        os: linux
        arch: arm64
---
```

### Binary Name Change

Rename the compiled binary from `agent-server` to `yourbro-agent` for clarity and discoverability on PATH.

## Technical Approach

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  ClawHub Registry                                        │
│  ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │ Skill Package       │    │ GitHub Releases          │  │
│  │ - SKILL.md          │    │ - yourbro-agent-darwin-* │  │
│  │ - scripts/          │    │ - yourbro-agent-linux-*  │  │
│  │ - contrib/          │    │ - checksums.txt          │  │
│  └─────────┬───────────┘    └────────────┬────────────┘  │
└────────────┼─────────────────────────────┼───────────────┘
             │ clawhub install             │ download
             ▼                             ▼
┌──────────────────────────────────────────────────────────┐
│  User's Machine                                          │
│                                                          │
│  ~/.openclaw/skills/yourbro/SKILL.md  (skill loaded)     │
│  ~/.openclaw/bin/yourbro-agent        (binary on PATH)   │
│  ~/.openclaw/openclaw.json            (configuration)    │
│  ~/.yourbro/agent.db                  (data, runtime)    │
└──────────────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Agent Binary Hardening (pre-requisite changes to agent/ source)

**Goal:** Make the agent binary suitable for standalone distribution outside Docker.

**Tasks:**

1. **Replace `mattn/go-sqlite3` with `modernc.org/sqlite`**
   - Eliminates CGO requirement entirely
   - Enables trivial cross-compilation: `GOOS=X GOARCH=Y go build`
   - Removes need for `gcc`, `musl-dev` in build stage
   - Pure Go, well-tested, production-ready
   - Run existing test suite to validate compatibility
   - Files: `agent/go.mod`, `agent/internal/storage/sqlite.go`, `agent/internal/storage/sqlite_test.go`

2. **Change default SQLITE_PATH**
   - Current default: `/data/agent.db` (requires root on bare metal)
   - New default: `~/.yourbro/agent.db` (user-writable)
   - Auto-create directory if it doesn't exist
   - Docker Compose overrides to `/data/agent.db` via env var (unchanged behavior)
   - File: `agent/cmd/server/main.go`

3. **Add `--version` flag and `/version` endpoint**
   - Inject version at build time via `ldflags`: `-X main.version=v1.0.0`
   - `yourbro-agent --version` prints version and exits
   - `GET /version` returns `{"version":"v1.0.0"}`
   - Enables `clawhub` to check for updates
   - File: `agent/cmd/server/main.go`

4. **Make CORS origins configurable**
   - Add `CORS_ORIGINS` env var (comma-separated)
   - Default: `https://yourbro.ai,http://localhost:5173,http://localhost,null`
   - File: `agent/internal/middleware/cors.go`, `agent/cmd/server/main.go`

5. **Make TLS cert path configurable**
   - Add `CERT_CACHE_PATH` env var
   - Default: `~/.yourbro/certs` (was hardcoded `/data/certs`)
   - Docker Compose overrides to `/data/certs`
   - File: `agent/cmd/server/main.go`

6. **Unify token naming**
   - Rename `YB_API_TOKEN` to `YOURBRO_TOKEN` in agent code
   - Keep `YB_API_TOKEN` as a fallback alias for backwards compatibility (check both, prefer `YOURBRO_TOKEN`)
   - File: `agent/cmd/server/main.go`

7. **Add SIGHUP handler for new pairing code**
   - On `SIGHUP`, generate and log a new pairing code with fresh 5-min expiry
   - Allows users to get new codes without restarting: `kill -HUP $(pidof yourbro-agent)`
   - File: `agent/cmd/server/main.go`

**Success criteria:**
- `go build` works without CGO (`CGO_ENABLED=0`)
- All existing tests pass with `modernc.org/sqlite`
- Binary starts successfully on macOS and Linux without Docker
- `yourbro-agent --version` prints version
- `curl localhost:9443/version` returns version JSON

**Estimated scope:** ~8 files modified in `agent/`

---

#### Phase 2: Skill Package Restructuring

**Goal:** Restructure `skill/` to be a valid OpenClaw skill with proper frontmatter and metadata.

**Tasks:**

1. **Rewrite `skill/SKILL.md`**
   - Add YAML frontmatter with `name`, `description`, `metadata.openclaw` (install specs, requirements, env vars)
   - Restructure body into clear sections: overview, configuration, usage instructions, examples
   - Add configuration reference table for all env vars
   - File: `skill/SKILL.md`

2. **Update `skill/scripts/publish.sh`**
   - Change `YOURBRO_TOKEN` reference to match unified env var name
   - Add `--help` flag
   - File: `skill/scripts/publish.sh`

3. **Add contrib files**
   - `skill/contrib/yourbro-agent.service` — systemd unit template
   - `skill/contrib/com.yourbro.agent.plist` — macOS launchd plist template
   - `skill/contrib/docker-compose.yml` — Docker Compose config for users who prefer containers
   - `skill/contrib/Dockerfile` — slim Dockerfile for containerized agent (move from `Dockerfile.agent`)

4. **Create `.clawignore`** at repo root
   - Excludes `agent/`, `api/`, `web/`, `sdk/`, `migrations/`, `nginx/`, `deploy/`, `docs/`, `.env*`, `*.db`, build artifacts
   - Only `skill/` contents get published to ClawHub

5. **Remove empty `skill/templates/` directory**

**Success criteria:**
- `skill/SKILL.md` has valid YAML frontmatter
- `skill/` directory is a self-contained, valid OpenClaw skill
- `clawhub publish skill/` would only include skill contents (no source code, no secrets)

**Estimated scope:** 1 file rewritten, 4 new files, 1 directory removed

---

#### Phase 3: Cross-Platform Build Pipeline

**Goal:** Automate building and releasing pre-compiled binaries for all target platforms.

**Tasks:**

1. **Create GitHub Actions workflow** `.github/workflows/release-agent.yml`
   - Trigger on git tag `v*` (e.g., `v1.0.0`)
   - Build matrix: `{os: [linux, darwin], arch: [amd64, arm64]}`
   - With CGO eliminated (Phase 1), each job is simply:
     ```
     GOOS=$os GOARCH=$arch go build -ldflags "-X main.version=$tag" -o yourbro-agent-$os-$arch ./cmd/server
     ```
   - Generate SHA256 checksums file
   - Create GitHub Release with binaries + checksums
   - File: `.github/workflows/release-agent.yml`

2. **Update Makefile**
   - Add `build-agent-all` target that builds for all platforms locally
   - Add `release-agent` target that creates a tagged release
   - File: `Makefile`

3. **Update Dockerfile.agent**
   - Remove `gcc musl-dev` (no longer needed without CGO)
   - Set `CGO_ENABLED=0`
   - File: `Dockerfile.agent`

**Success criteria:**
- Pushing a `v*` tag triggers automated builds for 4 platform/arch combos
- GitHub Release page has binaries + checksums.txt
- Docker build still works (for users who prefer Docker)

**Estimated scope:** 1 new workflow file, 2 files modified

---

#### Phase 4: Documentation and Migration

**Goal:** Document the new installation process and provide a migration path.

**Tasks:**

1. **Update README.md**
   - Add "Install via ClawHub" section
   - Add "Configuration Reference" with all env vars
   - Add "Running as a Service" section (systemd, launchd)
   - Keep Docker Compose section as an alternative

2. **Add installation guide to skill/SKILL.md body**
   - Step-by-step: install → configure → start → pair → publish
   - Configuration reference table
   - Troubleshooting section

3. **Update CLAUDE.md**
   - Document that `skill/` is the ClawHub package source
   - Document `clawhub publish skill/` workflow
   - Document release process (tag → CI → GitHub Releases)

**Success criteria:**
- New user can go from `clawhub install yourbro` to publishing a page by following the docs
- Existing Docker Compose users understand the relationship to the new package

**Estimated scope:** 3 files modified

## Alternative Approaches Considered

### 1. Ship Go source in the skill (rejected)
- Skill would include full `agent/` source and use `go install` to build on target
- **Rejected because:** CGO dependency (if we didn't switch to pure-Go SQLite) makes this fragile. Even with pure-Go SQLite, requiring a Go toolchain on every user's machine is a high barrier. Pre-compiled binaries are standard practice.

### 2. Docker-only distribution (rejected)
- Skill would run the agent via Docker container exclusively
- **Rejected because:** Adds Docker as a hard dependency for all OpenClaw users. Many will run OpenClaw on lightweight systems without Docker. Goes against the user's requirement to "manually upload compiled binary."

### 3. Keep skill/ and agent/ separate (rejected)
- Publish two separate ClawHub packages: `yourbro-skill` and `yourbro-agent`
- **Rejected because:** User explicitly wants them "installed together." Splitting increases installation friction and version sync issues.

### 4. Embed agent binary in the skill package (rejected)
- Include pre-compiled binaries directly in the skill directory shipped to ClawHub
- **Rejected because:** Would make the skill package ~60MB+ (4 platform binaries at ~15MB each). ClawHub is designed for lightweight skill bundles. The download installer pattern is the standard approach.

## Acceptance Criteria

### Functional Requirements

- [ ] `clawhub install yourbro` installs the skill and downloads the correct agent binary
- [ ] `yourbro-agent` starts successfully reading config from environment variables
- [ ] `yourbro-agent --version` prints the version
- [ ] `GET /version` endpoint returns version JSON
- [ ] Default `SQLITE_PATH` is `~/.yourbro/agent.db` (auto-creates directory)
- [ ] `kill -HUP <pid>` generates and logs a new pairing code
- [ ] CORS origins configurable via `CORS_ORIGINS` env var
- [ ] TLS cert cache path configurable via `CERT_CACHE_PATH` env var
- [ ] `YOURBRO_TOKEN` env var works for both publishing and heartbeat
- [ ] `YB_API_TOKEN` still works as backwards-compatible alias
- [ ] Docker Compose workflow still works for self-hosting users
- [ ] No secrets present in the published skill package

### Non-Functional Requirements

- [ ] Agent binary builds without CGO (`CGO_ENABLED=0`)
- [ ] Cross-compilation produces working binaries for linux/{amd64,arm64} and darwin/{amd64,arm64}
- [ ] Binary size is reasonable (~15MB or less per platform)
- [ ] All existing agent tests pass with `modernc.org/sqlite`

### Quality Gates

- [ ] `go test ./...` passes in `agent/`
- [ ] GitHub Actions workflow successfully builds all 4 platform binaries
- [ ] SHA256 checksums match downloaded binaries
- [ ] `.clawignore` verified to exclude all sensitive files
- [ ] No `.env` files or tokens present in skill package

## Success Metrics

- Users can install yourbro on OpenClaw in under 5 minutes
- Zero manual binary compilation required for end users
- Configuration is fully guided through `openclaw.json` (no .env file editing)
- Existing Docker Compose users are not broken

## Dependencies & Prerequisites

| Dependency | Status | Notes |
|---|---|---|
| OpenClaw `download` installer kind | Assumed available | Per docs, `kind: download` is a supported installer type |
| GitHub Releases hosting | Available | Standard GitHub feature, no setup needed |
| `modernc.org/sqlite` compatibility | Must verify | Run test suite against pure-Go SQLite before committing |
| `clawhub` CLI | Assumed installed on target | Required for `clawhub install` |

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `modernc.org/sqlite` incompatibility with existing queries | Low | High | Run full test suite before merging. The driver is highly compatible with `mattn/go-sqlite3`. |
| ClawHub `download` installer doesn't support OS/arch filtering | Medium | High | Fall back to a single download URL with platform in filename; user selects manually. Or use a shell script installer. |
| Binary download fails (network, wrong platform) | Medium | Medium | Provide clear error messages and manual download fallback in SKILL.md. |
| Secrets leaked in published package | Low | Critical | `.clawignore` + CI check that verifies no `.env` or token patterns in the publish output. |
| Existing Docker Compose users confused by restructuring | Medium | Low | Keep `Dockerfile.agent` and `docker-compose.agent.yml` working. Add migration note in README. |

## Resource Requirements

- **Code changes:** ~12 files modified/created in `agent/`, ~6 files in `skill/`
- **CI setup:** 1 GitHub Actions workflow
- **Testing:** Agent test suite re-run against new SQLite driver
- **No infrastructure changes** — uses GitHub Releases (free) for binary hosting

## Future Considerations

- **ClawHub publishing:** Once the structure is validated locally, `clawhub publish skill/` makes it available to all OpenClaw users
- **Auto-update:** ClawHub's `clawhub update` can pull new binary versions when releases are tagged
- **Windows support:** If demand exists, add `windows/amd64` to the build matrix (pure-Go SQLite makes this trivial)
- **Process supervision integration:** The contrib service files (systemd, launchd) could become first-class `clawhub` managed services if OpenClaw adds service management
- **Pairing UX improvement:** Consider a web-based pairing flow where the agent serves a local pairing page at `localhost:9443/pair` instead of requiring users to read log output

## Documentation Plan

| Document | Action |
|---|---|
| `skill/SKILL.md` | Rewrite with OpenClaw frontmatter + full usage guide |
| `README.md` | Add ClawHub install section, configuration reference |
| `CLAUDE.md` | Add ClawHub publish and release process |
| `docs/solutions/` | Document decisions post-implementation via `/compound` |

## References & Research

### Internal References
- Current SKILL.md: `skill/SKILL.md`
- Agent entrypoint: `agent/cmd/server/main.go`
- CORS config: `agent/internal/middleware/cors.go`
- SQLite storage: `agent/internal/storage/sqlite.go`
- Docker agent build: `Dockerfile.agent`
- Agent compose: `docker-compose.agent.yml`
- Security audit: `SECURITY_TO_FIX_BEFORE_PUBLIC.md`

### External References
- OpenClaw Skills docs: https://docs.openclaw.ai/tools/skills
- ClawHub docs: https://docs.openclaw.ai/tools/clawhub
- `modernc.org/sqlite` (pure-Go SQLite): https://pkg.go.dev/modernc.org/sqlite
- AgentSkills specification (referenced in OpenClaw docs)

### Related Work
- Security audit findings (#2 XSS, #3 JWT) should be addressed before public ClawHub release
- Landing page plan: `docs/plans/2026-03-04-feat-add-security-and-integration-tests-plan.md`

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `YOURBRO_TOKEN` | Yes (for publishing + heartbeat) | — | API token from yourbro dashboard |
| `YB_SERVER_URL` | No (enables heartbeat) | — | yourbro server URL (e.g., `https://yourbro.ai`) |
| `YB_AGENT_ENDPOINT` | No (enables heartbeat) | — | Public URL of this agent (e.g., `https://agent.example.com:9443`) |
| `AGENT_PORT` | No | `9443` | Port the agent listens on |
| `AGENT_DOMAIN` | No | — | Domain for autocert TLS (omit for dev/plain HTTP) |
| `SQLITE_PATH` | No | `~/.yourbro/agent.db` | Path to SQLite database |
| `CERT_CACHE_PATH` | No | `~/.yourbro/certs` | TLS certificate cache directory |
| `CORS_ORIGINS` | No | `https://yourbro.ai,...` | Comma-separated allowed CORS origins |

## Open Questions

> These should be resolved before or during implementation:

1. **Does ClawHub's `download` installer kind support OS/arch filtering?** The docs mention it but don't show the exact schema with `os`/`arch` fields. If not, we may need a single download URL that's a shell script selecting the right binary.

2. **How does OpenClaw inject `openclaw.json` env vars into skill binaries?** If it doesn't (skill env vars only inject into the agent session, not into separate daemon processes), we need to either:
   - (a) Have the SKILL.md instructions tell the user to set env vars in their shell profile
   - (b) Have the skill launch the agent process with the right env vars
   - (c) Have the agent binary optionally read from `~/.openclaw/openclaw.json` directly

3. **What is the exact `clawhub publish` directory behavior?** Does it publish the contents of the specified directory, or the directory itself? This affects whether we run `clawhub publish skill/` or `clawhub publish .` with a `.clawignore`.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## Version Scheme

- **v1.x** = Claude Code **CLI** + Proxy (before extension)
- **v2.x** = Claude Code **Extension** + Proxy (within Antigravity IDE)

---

# Version 2.x — Extension + Proxy

## [2.11.0] - 2026-10-21

Conformance, resilience and hardening release. Everything is verified offline against a mock upstream; see [RELEASE_NOTES_v2.11.0.md](RELEASE_NOTES_v2.11.0.md).

### Added
- **Conformance suite**: 37 synthetic JSON fixtures (`test/fixtures/conformance/`) replayed against the real proxy and a scripted mock Cloud Code upstream. They cover request/response mapping, SSE event order, tool_use/tool_result round-trips, system prompts, stop reasons, usage fields, thinking models, 4xx/5xx/429 mapping with `retry-after`, timeouts, request validation and the header allow-list.
- **Resilience**: exponential backoff with full jitter and `Retry-After` support (`src/resilience/backoff.js`). 5xx, network and timeout failures are retried up to `UPSTREAM_RETRIES` times per request; timeouts at most once. A stream that has already reached the client is never retried. Retries stop when the client disconnects.
- **Error mapping** to Anthropic error types (400/401/403/404/413/429/502/504/529) with a `retry-after` header when the reset time is known (`src/http/error-mapper.js`). Exhausted quota stays a 400 by default; `RATE_LIMIT_STATUS=429` opts into 429.
- **Operability**: `GET /livez`, `GET /readyz` and `GET /metrics` (Prometheus text: requests, latency, upstream retries, account states). Graceful shutdown drains in-flight SSE streams; a second signal forces exit.
- **Hardening**: request validation with one clear 400 listing every problem, JSON 400/413 for malformed or oversized bodies (`REQUEST_BODY_LIMIT`, default `32mb`), an allow-list for routing headers, client credentials never forwarded upstream, secret redaction for console and log file, helmet-style security headers, and a per-client rate limit for management endpoints (`MANAGEMENT_RATE_LIMIT`).
- **Docker**: multi-stage image that runs as the non-root `node` user, with a healthcheck. CI builds it and smoke-runs it.
- **Quality gates**: `// @ts-check` + `tsc --noEmit`, ESLint and Prettier checks, c8 coverage gate (80% lines, statements, functions and branches on the core request path), CodeQL, Dependabot (npm, actions, Docker), Node 20 + 22 matrix.
- **Release workflow** (`.github/workflows/release.yml`): a `vX.Y.Z` tag builds the GitHub release from committed release notes and marks it Latest.

### Fixed
- Array `system` prompts (what Claude Code sends) were forwarded as `"[object Object]"`.
- `stop_sequences` were dropped.
- `tool_result` blocks were sent to Gemini named after the tool_use id instead of the tool.
- Tool-schema hints were appended twice. `const` reached Gemini unconverted. `sanitizeSchema` turned typeless enums into placeholder objects.
- An upstream 401 ended in "Max retries exceeded". It now retries once with a fresh token, then returns 401.
- Streaming requests that failed before the first event returned 200 with an in-stream error. They now get the real status and `retry-after`.

### Security
- The natural-language model-switch regexes ran in quadratic time on prompt text (ReDoS); they are now linear.
- Perplexity API key fragments and OAuth state fragments are no longer logged. Sign-in settings are kept apart from the OAuth client secret.
- Redaction covers Google, Anthropic and Perplexity keys, OAuth access and refresh tokens, JWT/cookie session tokens and OAuth client secrets.

### Changed
- `package.json` version now follows the proxy release scheme (`2.11.0`; it previously carried `4.1.0`). Node.js 20+ is required.
- Extension releases use `ext-vX.Y.Z` tags (`publish.yml`, `auto-release.yml`); `vX.Y.Z` tags are proxy releases only. Open VSX publishing is skipped when `OVSX_PAT` is missing or the version is already published.

---

## [2.10.0] - 2026-10-03

### Added
- Offline test suite (`node:test`): the real proxy runs against a mock Cloud Code server in a temp home, so `npm test` needs no accounts or network. The live suite moved to `npm run test:live`.
- GitHub Actions CI: lint and tests on Node 20 and 22, `npm audit` on runtime dependencies, and a gitleaks scan of the full history and working tree.
- `.env.example` documenting every setting; `HOST`, `PROXY_STATE_DIR`, `CORS_ALLOWED_ORIGINS` and `CLOUDCODE_ENDPOINTS` settings.

### Fixed
- Gemini function calls now return `stop_reason: tool_use` (streaming and non-streaming), so Claude Code tool loops continue.
- Per-session model selection (`X-Session-ID`) is no longer overwritten.
- With no accounts, `/v1/messages` fails fast with a clear error instead of hanging; `/v1/models` survives an upstream listing failure.
- A malformed `accounts.json` is no longer overwritten; transient token-refresh errors rotate to the next account instead of invalidating it.
- Windows setup scripts and the PM2 entry point pointed at the wrong paths.

### Security
- Binds to `127.0.0.1` by default; foreign `Origin` requests and non-local `Host` headers (DNS rebinding) are refused.
- Model names are validated before being written to editor `settings.json`; dashboard and OAuth error page escape server-provided values (XSS).
- Account, session and `.env` files are written with mode `0600`.
- The Google OAuth client secret is read from `GOOGLE_OAUTH_CLIENT_SECRET` instead of being embedded in source.
- Puppeteer (used only by Perplexity browser login) is now an optional peer dependency loaded on first use: the default install drops 148 packages and `npm audit` goes from 8 high advisories to 0.

---

## [2.9.0] - 2026-01-25

### Extension v4.3.0
- **Default Proxy Disabled**: Proxy no longer auto-starts on first install
- **Respects Extension State**: Proxy only starts when extension is enabled in Extension Manager
- **Removed Auto-Run Task**: Removed `tasks.json` startup task that launched proxy on folder open
- **Optional System Startup**: Users can manually enable system startup via `scripts/setup/SETUP_STARTUP.bat`

### Changed
- Extension defaults to disabled state on fresh install
- Proxy auto-starts ONLY when extension is enabled

---

## [2.8.0] - 2026-01-03

### Setup Improvements
- **PM2-Based Startup**: Proxy now runs via PM2 for robust background operation
- **Unified Setup Script**: `SETUP_STARTUP.bat` installs PM2, registers proxy, and configures auto-start
- **Window Independence**: Closing any IDE window no longer affects the proxy
- **Multi-User Ready**: Works with Claude Code CLI, Antigravity, VS Code, and terminals simultaneously

### Changed
- Removed VBS-based startup scripts (moved to `_archive/`)
- Updated README with PM2 instructions and auto-start guide
- `COMPLETE_SETUP.bat` now uses PM2 instead of `npm start`

### Fixed
- Proxy going offline when closing the project window

---

## [2.7.1] - 2026-01-03

### Extension v4.2.2
- **Proxy Toggle Fix**: Fixed toggle not working in offline state - now properly disables/enables
- **Correct Server Path**: PM2 fallback uses correct `server.js` entry point
- **Toggle Action Handling**: Model switcher correctly processes toggle in all states

---

## [2.7.0] - 2026-01-03

### Extension v4.1.1
- **Per-Window Model Selection**: Each window maintains its own model independently
- **Workspace Persistence**: Model choice persists per-workspace across restarts
- **Disabled Settings Watchers**: Fixed issue where global settings were overriding window-local models
- **No More Model Ping-Pong**: Multiple windows no longer conflict over model selection

### Proxy Fixes
- **Correct Entry Point**: PM2 now starts `index.js` instead of `server.js`
- **Session Persistence**: Models survive proxy restarts

---

## [2.6.0] - 2026-01-03

### Added
- **Per-Session Model Isolation**: Each Antigravity window and CLI terminal has its own model
- **Sessions Dashboard Tab**: View all active sessions with model, last used time, and delete option
- **Session Persistence**: Models are persisted per-session in `session-models.json` and survive proxy restarts
- **Auto-Restart on Crash**: Proxy automatically restarts via PM2, sessions resume with their models
- **Universal CLI Support**: Set permanent `ANTHROPIC_BASE_URL` env var for all terminals
- **Cross-Shell Wrappers**: `claude-session.bat` and `claude-session.sh` for per-folder sessions

### Changed
- Extension now uses `/session-model` API instead of `/active-model` for per-window isolation
- Dashboard Sessions page shows auto-session enabled status instead of manual setup instructions

### Fixed
- **Proxy Entry Point**: Fixed PM2 to start `index.js` instead of `server.js` (was causing immediate shutdown)
- **Model Reversion Issue**: Windows no longer affect each other's models

---

## [2.5.0] - 2026-01-02

### Added
- **IDE Account Switcher**: `$(account)` icon in status bar to manage Antigravity IDE accounts
- **Simplified 2-Icon Layout**: Account icon + Model name (shows "Offline" in red when proxy down)
- **Dashboard Improvements**: Yellow highlighted warning about UI name not updating

### Fixed
- **API Endpoint Mismatch**: Fixed `/set-model` → `/active-model` in extension
- **Model Sync**: Claude Code UI selection now syncs properly without reverting

---

## [2.4.0] - 2026-01-02

### Added
- **Direct OAuth Re-authentication**: Expired accounts can be re-authenticated from dashboard
- **Persistent Multi-State OAuth Server**: Supports unlimited back-to-back account additions
- **Auto-Refresh Dashboard**: Polls every 2 seconds after OAuth, shows ✅ toast on success
- **Enhanced OAuth Logging**: Detailed flow tracking with state IDs

### Fixed
- "OAuth flow already in progress" blocking back-to-back logins
- "State mismatch / CSRF attack" errors on consecutive OAuth attempts

---

## [2.3.0] - 2026-01-01

### Added
- **Per-Window Model Selection**: Each Antigravity window can use different models
- **Account Reset Countdown**: Dashboard shows Claude quota reset time per account
- **Dark Theme Dashboard**: Modern OpenAI/Apple-inspired design with Inter font

### Changed
- Model dropdown reordered: Claude → Gemini 3 → Gemini 2.5 → GPT → Other
- Health check polling now every 5 seconds

---

## [2.2.0] - 2026-01-01

### Added
- **PM2 Process Manager**: Automatic crash recovery and process management
- **Windows Startup Script**: Triple-layer auto-start protection
- **Material Design Dashboard**: Google Material Symbols, dark zinc palette

### Changed
- Startup task uses `pm2 resurrect` instead of direct `node` call

---

## [2.1.0] - 2026-01-01

### Added
- **Robust Model Routing**: Claude Code dropdown has highest priority
  - Haiku → `gemini-3-flash`
  - Opus → `claude-opus-4-5-thinking`
  - Sonnet/Default → `claude-sonnet-4-5-thinking`
  - Custom → Uses dashboard/status bar selection
- **Status Bar Sync**: Updates to show actual model being used
- **Faster Offline Detection**: 2-second timeout

### Fixed
- Status bar not updating when switching models via dropdown
- Model priority conflicts between dashboard and extension

---

## [2.0.0] - 2026-01-01

### Added
- **Status Bar Extension**: Real-time model indicator with emoji icons (⚡💎🎭🎵)
- **3-Second Polling**: Status bar auto-updates from `/active-model`
- **Model Change Notifications**: Toast when model changes via dashboard
- **Extension Model Mapping**: Modified `extension.js` for proper dropdown routing

### Changed
- Bidirectional sync between extension and proxy
- Updated README with showcase section

---

# Version 1.x — CLI + Proxy

## [1.2.0] - 2025-12-31

### Added
- **Smart Routing**: Extension dropdown pass-through support
- **Dashboard Override**: "Custom model" uses dashboard-selected model
- **Model Persistence**: Survives proxy restarts via `model-override.json`
- **Auto-Start**: Proxy starts on Antigravity open via `tasks.json`
- **Enhanced Logging**: Detailed route logging with source tracking

---

## [1.1.0] - 2025-12-30

### Added
- **Multi-Account Load Balancing**: 4 Google accounts with automatic rotation
- **Perplexity Integration**: GPT-5, Grok, Kimi, Claude via Perplexity
- **Beautiful Dashboard**: Real-time account monitoring at `localhost:8080`
- **Model Aliases**: Type `flash` instead of `gemini-3-flash`

---

## [1.0.0] - 2025-12-29

### Added
- Initial release
- Anthropic-compatible API proxy
- Google AI integration via Antigravity
- Basic streaming support
- CLI model switching with `/model` command

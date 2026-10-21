<p align="center">
  <img src="docs/banner.svg" alt="Antigravity Claude Code Proxy" width="100%">
</p>

<p align="center"><strong>Run Claude Code on Gemini, Claude and Perplexity models through one local, Anthropic-compatible endpoint.</strong></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/muhib-karim/Antigravity-Claude-Code-Proxy" alt="License: MIT"></a>
  <img src="https://img.shields.io/github/languages/top/muhib-karim/Antigravity-Claude-Code-Proxy" alt="Top language">
  <a href="https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/actions/workflows/ci.yml"><img src="https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://open-vsx.org/extension/ai-dev-2024/claude-proxy-status"><img src="https://img.shields.io/open-vsx/v/ai-dev-2024/claude-proxy-status?label=Open%20VSX" alt="Status bar extension on Open VSX"></a>
</p>

<p align="center">
  <a href="https://muhib-karim.github.io/Antigravity-Claude-Code-Proxy/">Website</a> •
  <a href="#quick-start">Quick start</a> •
  <a href="#usage">Usage</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#upstream-and-what-this-fork-adds">What this fork adds</a> •
  <a href="#testing">Testing</a>
</p>

Based on [antigravity-claude-proxy](https://github.com/badrisnarayanan/antigravity-claude-proxy) by Badri Narayanan S (MIT License).

---

## What it is

Antigravity Claude Code Proxy is a local Node.js/Express gateway. It speaks the **Anthropic Messages API** (`/v1/messages`, with SSE streaming), so Claude Code and other Anthropic clients only need `ANTHROPIC_BASE_URL` pointed at it. It translates each request into the format the upstream provider expects, sends it with the signed-in account it picked, and translates the response (text, tool calls and thinking blocks) back.

### Key features

- **Anthropic-compatible API**: `/v1/messages` (streaming and non-streaming), `/v1/messages/count_tokens` and `/v1/models`.
- **Two-way format translation** (`src/format/`): messages, system prompts, images/documents, tool calls and results, and thinking blocks with signature handling. Also includes a JSON-schema sanitizer for tool definitions the Cloud Code API would otherwise reject.
- **Multi-account handling**: Google accounts added through OAuth are stored owner-only (`0600`). Requests use a sticky account for caching, accounts are rotated with cool-downs when rate-limited, and requests fail over when a token refresh fails.
- **Model routing**: 37 built-in short aliases (`flash`, `pro`, `opus`, …), a global model override (`/active-model`), and per-session models via the `X-Session-ID` header (`/session-model`).
- **Web dashboard** at `/dashboard`: accounts, quotas, usage per model, sessions and model switching.
- **Local-only by default**: binds to `127.0.0.1` and refuses foreign `Origin` headers and DNS-rebinding style `Host` headers.
- **CLI** (`bin/cli.js`): start the server and manage accounts (`add`, `list`, `remove`, `verify`, `clear`). `scripts/doctor.js` runs a setup self-check.
- **Status bar extension** for VS Code-based editors, [published on Open VSX](https://open-vsx.org/extension/ai-dev-2024/claude-proxy-status). It shows the active model and quotas and allows one-click switching.

> **Verification scope.** CI runs lint and offline tests on Node 20 and 22 using mocked upstreams, plus secret scanning and a runtime dependency audit. Those checks do not establish current access to every remote model or account. Provider names and model identifiers can change; verify the configured provider before relying on it.
>
> The gateway runs locally, but prompts and code sent for inference are forwarded to the configured provider. Account credentials, OAuth setup and provider quotas are your responsibility. Do not publish credentials, logs with tokens, or real account screenshots in a public issue. A static showcase or mocked test is not a live-provider benchmark.

### Demo

Real output from this repository, rendered to SVG (CLI help plus the offline test run):

<p align="center"><img src="docs/demo-terminal.svg" alt="Terminal session: CLI help and npm test with 50 passing tests" width="760"></p>

<details>
<summary>Dashboard and status bar screenshots</summary>

<p align="center">
  <img src="docs/images/dashboard.png" alt="Dashboard" width="700"><br><em>Web dashboard</em><br><br>
  <img src="docs/images/quota-popup.png" alt="Quota popup" width="600"><br><em>Quota popup in the status bar extension</em><br><br>
  <img src="docs/images/model-switcher.png" alt="Model switcher" width="400"><br><em>Model switcher</em><br><br>
  <img src="docs/images/statusbar-icon.png" alt="Status bar" width="300"><br><em>Active model in the editor status bar</em>
</p>
</details>

---

## Upstream and what this fork adds

**Upstream:** [badrisnarayanan/antigravity-claude-proxy](https://github.com/badrisnarayanan/antigravity-claude-proxy) by Badri Narayanan S, [MIT License](LICENSE). The upstream copyright notice is kept in [LICENSE](LICENSE) and credited in [NOTICE](NOTICE). Upstream provides the core gateway: the Anthropic ↔ Google format converters in `src/format/`, the Cloud Code client, the multi-account manager, OAuth account onboarding and the CLI.

Everything below was added in this repository on top of that base (`C` = commit, links go to the change).

**Earlier releases (v2.0–v2.10)**

| Area | Added | Where |
|---|---|---|
| Providers | Perplexity routing (API key, session and browser login), auto-fallback to Gemini when tools are used | [C 72a5326](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/72a5326), [C c182a3e](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/c182a3e) |
| Model routing | 37 short aliases, global override, per-session models via `X-Session-ID`, sessions dashboard | [C c182a3e](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/c182a3e), [C 2d18b89](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/2d18b89) |
| Editor integration | Status bar extension (Open VSX) and its release workflows | [C 7265a2d](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/7265a2d), [`.github/workflows/publish.yml`](.github/workflows/publish.yml) |
| Tests and CI | Offline smoke suite against a mock upstream (`tests/smoke/`), Node 20/22 CI, gitleaks, npm audit | [C 9244ca4](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/9244ca4), [C 603c9ce](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/603c9ce), [C 7c5fd03](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/7c5fd03) |
| Security | Loopback bind, Origin/Host (DNS-rebinding) checks, `0600` account files, OAuth secret moved to env, Puppeteer made optional | [C 9244ca4](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/9244ca4) |
| Docs | Project website on GitHub Pages | [C c97a889](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/c97a889), [`site/`](site/) |

**v2.11.0 (this release)**

| Area | Added | Where |
|---|---|---|
| Conformance | 30 synthetic JSON fixtures replayed against the real proxy and a scripted mock upstream: request/response mapping, SSE event order, tool_use/tool_result round-trips, system prompts, stop reasons, usage fields, 4xx/5xx/429 mapping with `retry-after`, timeouts, validation, header allow-list | [`test/conformance/`](Antigravity-Claude-Code-Proxy/test/conformance/messages.test.mjs), [`test/fixtures/conformance/`](Antigravity-Claude-Code-Proxy/test/fixtures/conformance/), [C 174caa1](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/174caa1) |
| Bugs found by the suite | Array `system` prompts (what Claude Code sends) were sent upstream as `"[object Object]"`; `stop_sequences` were dropped; `tool_result` was named after the tool id instead of the tool; tool-schema hints were duplicated and `const` was passed to Gemini; a 401 ended in "Max retries exceeded" | [C 89125c3](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/89125c3), [C 4dfe982](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/4dfe982), [C ef43636](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/ef43636) |
| Resilience | Exponential backoff with full jitter, `Retry-After` (seconds or HTTP date) honoured, up to `UPSTREAM_RETRIES` 5xx/timeout/network retries per request (timeouts retried at most once) that never replay a started stream, deadlines (504) and client-disconnect cancellation, streaming errors before the first event returned with their real status and `retry-after`, graceful shutdown that drains SSE streams | [`src/resilience/backoff.js`](Antigravity-Claude-Code-Proxy/src/resilience/backoff.js), [`src/http/shutdown.js`](Antigravity-Claude-Code-Proxy/src/http/shutdown.js), [C 6c1739e](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/6c1739e), [C 8b5ca16](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/8b5ca16) |
| Error mapping | Anthropic error types for 400/401/403/404/413/429/502/504/529 with `retry-after` | [`src/http/error-mapper.js`](Antigravity-Claude-Code-Proxy/src/http/error-mapper.js), [C 7e22f23](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/7e22f23) |
| Hardening | Request validation with one clear 400, JSON errors for malformed/oversized bodies (413), routing-header allow-list, client credentials never forwarded upstream, secret redaction for console and log file, helmet-style headers, per-client rate limit, linear-time model-switch regexes (ReDoS), no API-key fragments in logs | [`src/http/validation.js`](Antigravity-Claude-Code-Proxy/src/http/validation.js), [`src/utils/redact.js`](Antigravity-Claude-Code-Proxy/src/utils/redact.js), [`src/http/security.js`](Antigravity-Claude-Code-Proxy/src/http/security.js), [C a091d61](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/a091d61) |
| Operability | `/livez`, `/readyz`, `/metrics` (Prometheus text: requests, latency, upstream retries, account states) | [`src/http/metrics.js`](Antigravity-Claude-Code-Proxy/src/http/metrics.js), [C 7890434](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/7890434) |
| Tests | Unit tests for backoff, error mapping, redaction, validation, metrics, shutdown, account cooldown/rotation and schema cleaning; integration tests for redaction, probes, rate limiting, shutdown and management endpoints (192 offline tests in total) | [`test/unit/`](Antigravity-Claude-Code-Proxy/test/unit/), [`test/integration/`](Antigravity-Claude-Code-Proxy/test/integration/) |
| Quality gates | `// @ts-check` + `tsc --noEmit`, ESLint and Prettier checks, c8 coverage gate (80% lines) on the core request path, CodeQL, Dependabot, CI on Node 20 and 22 | [`.github/workflows/ci.yml`](.github/workflows/ci.yml), [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml), [`.c8rc.json`](Antigravity-Claude-Code-Proxy/.c8rc.json), [C 1e573dd](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/commit/1e573dd) |

## Quick start

**Requirements:** Node.js 20+ (CI tests on Node 20 and 22), and the [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code). [PM2](https://pm2.keymetrics.io/) is optional, for running the proxy in the background.

```bash
git clone https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy.git
cd Antigravity-Claude-Code-Proxy/Antigravity-Claude-Code-Proxy   # the npm package lives in this folder

# PUPPETEER_SKIP_DOWNLOAD skips Chromium, which only Perplexity browser login needs
PUPPETEER_SKIP_DOWNLOAD=true npm ci

npm start                                  # foreground, http://127.0.0.1:8080
curl http://localhost:8080/health          # from another terminal
```

### Add a Google account

Google sign-in needs an OAuth client secret. It is **not** stored in this repository. Set it in your shell or in a `.env` file next to `package.json` (see `.env.example` for every setting):

```bash
export GOOGLE_OAUTH_CLIENT_SECRET="<your OAuth client secret>"
export GOOGLE_OAUTH_CLIENT_ID="<your OAuth client id>"   # optional, for your own OAuth app

npm run accounts:add     # opens a Google sign-in in your browser (needs a desktop browser)
npm run accounts:list
```

With no account configured the proxy still starts and `/health` answers, but `/v1/messages` returns a clear "No accounts available" error.

### Point Claude Code at the proxy

```bash
export ANTHROPIC_BASE_URL="http://localhost:8080"
export ANTHROPIC_API_KEY="antigravity-proxy"
claude
```

On Windows (PowerShell, not verified in CI):

```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "http://localhost:8080", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "antigravity-proxy", "User")
```

Optional background service: `pm2 start src/index.js --name antigravity-proxy && pm2 save`. The Windows batch helpers in `scripts/setup/` (PM2 registration, start-up on login) are Windows-only and are not verified in CI.

---

## Usage

```bash
node bin/cli.js --help          # CLI usage
node bin/cli.js start           # same as npm start; PORT=3000 to change the port
node bin/cli.js accounts verify # check stored tokens
npm run doctor                  # setup self-check
```

Switch models from Claude Code with `/model <name or alias>`, or from the dashboard at `http://localhost:8080/dashboard`:

| Alias | Resolves to | Notes |
|-------|-------------|-------|
| `flash`, `fast`, `haiku` | `gemini-3-flash` | Agentic (tool use) |
| `pro`, `strong` | `gemini-3-pro-high` | Agentic |
| `thinking` | `gemini-2.5-flash-thinking` | Agentic |
| `claude-opus`, `claude-sonnet` | `claude-opus-4-5-thinking`, `claude-sonnet-4-5-thinking` | Agentic, via Google Cloud Code |
| `opus`, `sonnet`, `grok`, `kimi`, `gpt` | `pplx-*` models | Perplexity, chat only (no tool use) |
| `sonar`, `research` | `sonar`, `sonar-deep-research` | Perplexity web search, chat only |

The full alias table is `MODEL_ALIASES` in [`src/constants.js`](Antigravity-Claude-Code-Proxy/src/constants.js). The model list from `/v1/models` is fetched live from the configured accounts.

### Main endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/messages` | POST | Anthropic Messages API (JSON or SSE) |
| `/v1/messages/count_tokens` | POST | Token counting |
| `/v1/models` | GET | Active model plus models available to the configured accounts |
| `/active-model` | GET / POST / DELETE | Global model override |
| `/session-model` | POST (`/:sessionId` GET / DELETE) | Per-session model |
| `/account-limits`, `/model-usage`, `/sessions` | GET | Quotas, usage and sessions for the dashboard |
| `/dashboard` | GET | Web dashboard |
| `/health` | GET | Health check |

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. The proxy has no authentication, so only use `0.0.0.0` if you really want other machines to reach it |
| `ACCOUNT_CONFIG_PATH` | `~/.config/antigravity-proxy/accounts.json` | Google account store |
| `PROXY_STATE_DIR` | package folder | Where `logs/`, `model-override.json` and `session-models.json` are written |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Extra comma-separated browser origins (localhost and editor webviews are always allowed) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | *(none)* | Required for Google sign-in and token refresh |
| `GOOGLE_OAUTH_CLIENT_ID` | built-in client id | For your own OAuth app |
| `CLOUDCODE_ENDPOINTS` | Google Cloud Code endpoints | Comma-separated upstream override (the tests point this at a mock server) |

---

## Architecture

```mermaid
flowchart LR
  CC["Claude Code / any Anthropic client"] -->|"Messages API + SSE"| SRV["server.js<br/>Express gateway on 127.0.0.1:8080"]
  EXT["Status bar extension"] -->|"model / quota polling"| SRV
  SRV --> DASH["public/dashboard.html"]
  SRV --> FMT["format/<br/>request + response converters,<br/>schema sanitizer, thinking utils"]
  FMT --> CCC["cloudcode-client.js<br/>retries + failover"]
  CCC --> AM["account-manager.js<br/>OAuth accounts, rotation, cool-downs"]
  AM --> OAUTH["oauth.js / token-extractor.js"]
  CCC -->|HTTPS| GCC[("Google Cloud Code API<br/>Gemini + Claude models")]
  SRV --> PPLX["perplexity-*-client.js"]
  PPLX -->|HTTP| PSRV[("Perplexity backend")]
```

- `src/index.js` starts `src/server.js`, the Express app with all routes, CORS/Host checks and model routing.
- `src/format/` converts Anthropic requests into Google Generative AI `contents`/`parts` and converts responses and SSE streams back. This includes tool calls, thinking signatures (with an in-memory signature cache) and recovery when a tool loop has lost its thinking blocks.
- `src/cloudcode-client.js` calls the upstream with retries and endpoint fallback. `src/account-manager.js` picks the account, refreshes tokens and backs off from rate-limited accounts.
- Perplexity models go through the `perplexity-*` clients. They are served by a separate Python server on `localhost:8000` that is **not part of this repository**, so they are not covered by the tests.

---

## Testing

Run from the package folder. These are the same steps CI runs ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
cd Antigravity-Claude-Code-Proxy
PUPPETEER_SKIP_DOWNLOAD=true npm ci
npm run lint          # ESLint: errors fail the build, warnings are reported
npm test              # 50 offline tests (Node's built-in test runner)
npm audit --package-lock-only --omit=dev --audit-level=high
```

`npm test` needs no accounts, keys or network. It covers:

- **Server integration**: starts the real proxy on a free port with a temporary home folder and a mock Cloud Code upstream. Covers `/health`, `/v1/models`, streaming and non-streaming `/v1/messages`, tool calls, per-session models, the no-account error path, model-switch endpoints, cross-origin and DNS-rebinding blocking, override persistence across restarts, and account rotation when a token refresh fails.
- **Unit tests**: request/response converters, content-to-parts conversion, the thoughtSignature cache, thinking-block filtering and tool-loop recovery, schema sanitizing, model aliases and error classes.
- **CLI smoke tests**: `--help`, `--version` and unknown-command handling of `bin/cli.js`.

The older end-to-end scripts talk to real models. They need a running proxy with at least one account and are not part of `npm test`: run `npm start` in one terminal and `npm run test:live` in another.

---

## Project structure

```
.
├── Antigravity-Claude-Code-Proxy/   # The npm package (run npm commands here)
│   ├── bin/cli.js                   # CLI entry point
│   ├── src/
│   │   ├── index.js                 # Starts the HTTP server
│   │   ├── server.js                # Express app and routes
│   │   ├── cloudcode-client.js      # Upstream client with retries/failover
│   │   ├── account-manager.js       # Multi-account handling
│   │   ├── format/                  # Anthropic <-> Google converters
│   │   ├── perplexity-*.js          # Perplexity clients and session managers
│   │   ├── constants.js             # Config and model aliases
│   │   └── public/dashboard.html    # Web dashboard
│   ├── scripts/                     # doctor.js, Perplexity login helpers
│   └── tests/
│       ├── smoke/                   # Offline tests run by `npm test`
│       └── *.cjs                    # Live tests run by `npm run test:live`
├── docs/                            # Setup guides, banner, demo, screenshots
├── site/                            # GitHub Pages site
├── scripts/setup/                   # Windows setup helpers (.bat)
├── bin/claude-session.{sh,bat}      # Session launcher helpers
└── .github/workflows/               # CI, Pages, release workflows
```

---

## Security

- The OAuth client secret comes from `GOOGLE_OAUTH_CLIENT_SECRET`. Older revisions embedded one that the upstream project publishes; it is no longer in the source and is allow-listed in `.gitleaksignore` for history scans.
- Account files are written with owner-only permissions. `.env`, account, token and log files are git-ignored.
- The headless-browser stack (Puppeteer) is an optional peer dependency used only by Perplexity browser login. The default install has no known advisories, and CI runs `npm audit` plus a full-history gitleaks scan.

See [SECURITY.md](SECURITY.md) for the full policy.

## Limitations and roadmap

- Live provider access (Google Cloud Code, Perplexity) is not exercised in CI; only mocked upstreams are.
- The Perplexity backend is a separate server that is not included here.
- The Windows setup scripts and PowerShell steps are not verified in CI.
- The status bar extension source (`claude-proxy-ext-src`) is referenced as a git submodule without a `.gitmodules` entry, so it is not checked out with this repository.

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT. See [LICENSE](LICENSE). Built on [antigravity-claude-proxy](https://github.com/badrisnarayanan/antigravity-claude-proxy) by Badri Narayanan S, used under the MIT License. The original copyright notice is kept in the license.

<p align="center">
  <a href="https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/issues">Report a bug</a> •
  <a href="https://ko-fi.com/ai_dev_2024">Support on Ko-fi</a> •
  <a href="https://startup.z.ai/">Part of the ZAI Start-up Community</a>
</p>

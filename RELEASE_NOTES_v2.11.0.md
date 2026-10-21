Antigravity Claude Code Proxy **v2.11.0** makes the gateway provably Anthropic-compatible, resilient under upstream failures, and safer to run. Everything in this release is verified offline: a scripted mock Cloud Code upstream and synthetic fixtures, no provider accounts.

## Highlights

- **Conformance suite.** 37 JSON fixtures replay real Claude Code traffic shapes against the proxy. They cover text, system prompts, tools and tool results, thinking models, streaming event order, stop reasons, usage fields, error mapping, timeouts and validation.
- **Five client-visible bugs fixed** (all found by that suite):
  - Claude Code's array `system` prompt reached the model as `"[object Object]"`.
  - `stop_sequences` were dropped.
  - Tool results were mis-named for Gemini.
  - Tool-schema hints were duplicated.
  - Streaming failures arrived as a 200 with an in-stream error instead of their real status and `retry-after`.
- **Resilience.** Exponential backoff with jitter. `Retry-After` is honoured, timeouts are bounded, a stream is never replayed once it has reached the client, retries stop when the client disconnects, and graceful shutdown drains open streams.
- **Operability.** `/livez`, `/readyz` and Prometheus `/metrics`.
- **Hardening.** One clear 400 for invalid requests and JSON 400/413 errors. Routing headers are allow-listed, and client credentials are never forwarded upstream. Secrets are redacted in logs. Security headers and a per-client rate limit are added, and a ReDoS in model-switch parsing is fixed.
- **Docker.** A multi-stage image that runs as a non-root user, with a healthcheck. It is built and smoke-tested in CI.
- **Quality gates.** Type checking (`@ts-check` + `tsc`), ESLint and Prettier checks, an 80% coverage gate (lines, statements, functions, branches), CodeQL with 0 open alerts, Dependabot, gitleaks and `npm audit` (0 runtime advisories). Tests run on Node 20 and 22.

## Upgrade notes

- Node.js **20+** is required.
- The default request body limit is now `32mb`, matching the Anthropic API. Override it with `REQUEST_BODY_LIMIT`.
- Malformed `/v1/messages` bodies now get a 400 instead of being forwarded.
- New settings: `UPSTREAM_RETRIES` (2), `RETRY_BASE_MS` (500), `RETRY_MAX_MS` (8000), `RATE_LIMIT_STATUS` (400; set 429 to let clients wait on `retry-after`), `MANAGEMENT_RATE_LIMIT` (300 per minute) and `SHUTDOWN_TIMEOUT` (30000).
- Extension releases now use `ext-vX.Y.Z` tags; `vX.Y.Z` tags are proxy releases only.

## Run it

```bash
docker build -t antigravity-claude-code-proxy Antigravity-Claude-Code-Proxy
docker run --rm -p 127.0.0.1:8080:8080 -v agp-data:/data antigravity-claude-code-proxy
```

Full details: [CHANGELOG.md](https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/blob/main/CHANGELOG.md). What this fork adds over [upstream](https://github.com/badrisnarayanan/antigravity-claude-proxy) (MIT): see the README section "Upstream and what this fork adds".

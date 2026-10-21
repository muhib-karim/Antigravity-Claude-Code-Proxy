# PROJECT_BRAIN

Handoff note for whoever (human or agent) picks this repo up next. Keep it short.

## What this repo is
Fork/extension of the MIT-licensed upstream `badrisnarayanan/antigravity-claude-proxy`: a local
Node.js/Express gateway that speaks the Anthropic Messages API and forwards to Google Cloud Code
(Gemini/Claude) or Perplexity. The npm package lives in `Antigravity-Claude-Code-Proxy/`.

## Rules
- No real provider credentials in tests; mock upstreams and synthetic fixtures only.
- Push only through the gated push script; never to main; never force.
- Node tests one process at a time; no watch mode.

## Status
v2.11.0 slice 1 on `upgrade/v2.11.0`: resilience, error mapping, validation, hardening,
metrics/health, graceful shutdown, 30-fixture conformance suite, coverage gate, @ts-check,
CI (quality, matrix, gitleaks, audit, CodeQL, Dependabot) committed. 192 offline tests green.

## Next step
Act on the slice-1 code review, re-run CI. Then slice 2
(Docker, README refresh, CHANGELOG/version, SKILLS_USED/TASKS/HANDOFF).

## Session log
- 2026-10-21 20:05Z claude-code/opus-5.5: created brain + slice-1 plan; next: tooling baseline
- 2026-10-21 21:10Z claude-code/opus-5.5: slice-1 code + CI committed (192 tests, cov 82.5%); next: push, CodeQL, provenance
- 2026-10-21 21:30Z claude-code/opus-5.5: pushed d0405e7; CI run 39670059079 green (5 jobs), CodeQL 0 open (6 clear-text-logging fixed); provenance+NOTICE done; next: review fixes

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
v2.11.0 slice 1 in progress on branch `upgrade/v2.11.0` (plan: `docs/superpowers/plans/2026-10-21-v2.11.0-slice1.md`).

## Next step
Task 1 (tooling baseline), then resilience modules.

## Session log
- 2026-10-21 20:05Z claude-code/opus-5.5: created brain + slice-1 plan; next: tooling baseline

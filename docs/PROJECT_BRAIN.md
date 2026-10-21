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
v2.11.0 complete on `upgrade/v2.11.0` (both slices): DoD 1-9 done, CI + CodeQL green with 0 alerts.
See TASKS.md (status per item) and HANDOFF.md (RUN vs INFERRED, CI ids, release flow).

## Next step
Coordinator: merge, check Pages 200, tag v2.11.0 on the merge commit, check the Release run (Latest).

## Session log
- 2026-10-21 20:05Z claude-code/opus-5.5: created brain + slice-1 plan; next: tooling baseline
- 2026-10-21 21:10Z claude-code/opus-5.5: slice-1 code + CI committed (192 tests, cov 82.5%); next: push, CodeQL, provenance
- 2026-10-21 21:30Z claude-code/opus-5.5: pushed d0405e7; CI run 39670059079 green (5 jobs), CodeQL 0 open (6 clear-text-logging fixed); provenance+NOTICE done; next: review fixes
- 2026-10-21 21:05Z claude-code/opus-5.5: slice 2 - Docker (CI), branches gate 80, README/Pages refresh, archify diagram, release.yml + ext-v tag split, CHANGELOG 2.11.0, SKILLS_USED/TASKS/HANDOFF; next: coordinator merge + tag

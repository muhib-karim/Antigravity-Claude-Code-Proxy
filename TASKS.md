# TASKS: v2.11.0 upgrade

Definition of Done for the v2.11.0 upgrade on branch `upgrade/v2.11.0`, with the evidence for each item. **RUN** means executed and observed (locally or in a GitHub Actions run listed in [HANDOFF.md](HANDOFF.md)). **INFERRED** means it follows from configuration that cannot run before the merge and tag.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Provenance: README "Upstream and what this fork adds" with upstream link, licence and linked additions; NOTICE/credits intact | Done | [README section](README.md#upstream-and-what-this-fork-adds), [NOTICE](NOTICE), [LICENSE](LICENSE) unchanged. RUN: every linked commit exists (`git cat-file -e`) |
| 2 | Conformance suite against a local mock upstream, synthetic JSON fixtures | Done | 37 fixtures in `Antigravity-Claude-Code-Proxy/test/fixtures/conformance/`, runner `test/conformance/messages.test.mjs`, scripted upstream `test/helpers/scripted-upstream.mjs`. RUN: 37/37 pass locally and in CI |
| 3 | Resilience: backoff + jitter honouring retry-after, per-account cooldown/rotation unit-tested, timeouts, graceful shutdown | Done | `src/resilience/backoff.js`, `src/http/shutdown.js`, `test/unit/account-rotation.test.mjs`, integration test for draining an open SSE stream. RUN in CI |
| 4 | Hardening: size limits, header allow-list, redaction test, security headers, `npm audit --omit=dev`, health + `/metrics` with tests | Done | `src/http/{validation,security,metrics}.js`, `src/utils/redact.js`, `test/integration/hardening.test.mjs`. RUN: `npm audit --omit=dev` found 0 vulnerabilities |
| 5 | `@ts-check` + `tsc --noEmit`, eslint + prettier, c8 >= 80%, Node 20 + 22, gitleaks, Dependabot, CodeQL, all green | Done | 15 `@ts-check` modules; c8 gate 80% for lines, statements, functions **and branches** (raised from 75% to 80% in slice 2; RUN in CI: branches 81.9%, lines 85.4%). CodeQL: 0 open alerts on the branch (RUN) |
| 6 | Docker image (multi-stage, non-root) built in CI, docker run instructions | Done | `Antigravity-Claude-Code-Proxy/Dockerfile`, CI job "Docker image (build + smoke run)". RUN in CI: user `node`, healthcheck healthy, `/livez` 200, JSON 400, exit 0 on `docker stop`. Not built locally, per the machine rules |
| 7 | README homepage refresh; Pages site updated and serving 200 | Done (Pages 200 is INFERRED until the merge) | README badges, mermaid architecture + streaming sequence (RUN: both render with mermaid 10.9.1), quickstart incl. Docker, configuration table, showcase, security, release flow. `site/index.html` refreshed (RUN: headless renders at 1280 and 390 px, detector clean). Pages deploys from `main` via `pages.yml`, so the 200 can only be checked after the merge |
| 8 | CHANGELOG [2.11.0] - 2026-10-21, version bump, SKILLS_USED.md, TASKS.md + HANDOFF.md | Done | [CHANGELOG.md](CHANGELOG.md), `package.json` 2.11.0, [RELEASE_NOTES_v2.11.0.md](RELEASE_NOTES_v2.11.0.md), [SKILLS_USED.md](SKILLS_USED.md), this file, [HANDOFF.md](HANDOFF.md) |
| 9 | Branch pushed via push.sh, CI fully green on its head | Done | See HANDOFF.md for the head commit's run ids |

## Release-flow requirements from the coordinator

| Requirement | Status | How |
|---|---|---|
| (a) Tag `v2.11.0` on the merge commit creates a GitHub release from committed notes, marked Latest | INFERRED (runs on the tag) | `release.yml`: checks the tag against `package.json`, runs the tests, then `gh release create --notes-file RELEASE_NOTES_v2.11.0.md --latest` (or `edit` if a release already exists). RUN: notes extraction and tag validation checked locally |
| (b) No stale extension republished to Open VSX, no failure on a missing secret | INFERRED | `publish.yml` now triggers only on `ext-v*` tags or manual dispatch, so it does not run on `v2.11.0`. Open VSX upload requires `OVSX_PAT`, a matching extension version and a version not already published; otherwise it prints a notice. Its release uses `make_latest: false` |
| (c) `auto-release.yml` cannot create a conflicting tag at merge | INFERRED | It now creates only `ext-vX.Y.Z` tags (it previously produced `v2.3.0` from extension 4.3.0). On the merge it may create `ext-v<extension version>` if missing; that tag does not start other workflows because it is pushed with `GITHUB_TOKEN` |

## Open items

- After merge: confirm the Pages deployment (Actions, workflow "pages") and that the site and `architecture/streaming-request.html` return 200.
- After tagging `v2.11.0`: confirm the "Release" run created the release from `RELEASE_NOTES_v2.11.0.md` and that it shows as Latest.
- Not blocked, not done: Docker image publishing to a registry (out of scope); `tsc` checking is limited to the `@ts-check` modules (`server.js` and `cloudcode-client.js` are not type-checked).

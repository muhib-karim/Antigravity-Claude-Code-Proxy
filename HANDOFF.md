# HANDOFF: v2.11.0

**Branch:** `upgrade/v2.11.0` (not merged; no PR opened). **Model used:** Claude Opus 5.5 (`claude-opus-5-5`) in Claude Code, one session, two slices. **Date:** 2026-10-21.

## What changed

Release summary: [RELEASE_NOTES_v2.11.0.md](RELEASE_NOTES_v2.11.0.md). Full list: [CHANGELOG.md](CHANGELOG.md#2110---2026-10-21). Item-by-item status: [TASKS.md](TASKS.md). Skills: [SKILLS_USED.md](SKILLS_USED.md).

- Slice 1 (DoD 1-5): provenance section and NOTICE, a 37-fixture conformance suite against a scripted mock upstream, resilience (backoff with jitter, Retry-After, bounded timeouts, graceful shutdown), hardening (validation, limits, header allow-list, redaction, security headers, rate limit), `/livez` `/readyz` `/metrics`, `@ts-check` + `tsc`, ESLint/Prettier, c8 gate, CodeQL, Dependabot. Six client-visible bugs were found by the suite and fixed.
- Slice 2 (DoD 6-9): multi-stage non-root Docker image built and smoke-run in CI, c8 branches gate raised to 80%, README homepage refresh, Pages site refresh plus a code-linked architecture diagram, `release.yml` and the `v*` / `ext-v*` tag split, CHANGELOG / version 2.11.0 / release notes, these handoff files.

## RUN (executed and observed)

| Check | Where | Result |
|---|---|---|
| Offline suites (smoke, unit, conformance, integration) | local, one process at a time; CI Node 20 + 22 | 222/222 pass |
| Coverage gate (c8, core request path) | local + CI | CI run 39674590224: lines 85.4%, statements 85.4%, functions 94.3%, branches 81.92% (Node 20) and 81.94% (Node 22); gate 80% each |
| ESLint, Prettier check, `tsc --noEmit` | local + CI | 0 errors (21 legacy ESLint warnings, which do not fail the build) |
| `npm audit --omit=dev` | local + CI | 0 vulnerabilities |
| gitleaks (history + tree) | push gate + CI | no leaks |
| CodeQL (JavaScript/TypeScript, default suite) | CI | 0 open alerts on the branch. The 6 `js/clear-text-logging` alerts from the first analysis were fixed in code, not dismissed |
| Docker build + smoke run | CI only (no local Docker builds) | image user `node`, healthcheck `healthy`, `/livez` 200, `/readyz` 503 with no accounts, JSON 400 on an invalid body, exit code 0 after `docker stop` |
| Workflow lint | `actionlint` 1.7.7 over `.github/workflows/*.yml` | clean |
| Release-notes extraction and tag pattern | local shell, same commands as `release.yml` | `v2.11.0` accepted; `ext-v4.3.0`, `v1.2`, `v2.3.0x` rejected; CHANGELOG section extraction works |
| README mermaid diagrams | headless Chromium + mermaid 10.9.1 | both render |
| Pages site | headless Chromium at 1280 and 390 px; impeccable detector | renders, no detector findings |
| Architecture diagram | archify finalize | validate, deliver, provenance check and browser check pass |

### CI run ids (GitHub Actions, `muhib-karim/Antigravity-Claude-Code-Proxy`)

| Commit | CI | CodeQL | Note |
|---|---|---|---|
| `2660d38` | 39669542039 (green) | 39669541244 | first CodeQL analysis: 6 alerts |
| `d0405e7` | 39670059079 (green) | 39670059126 | 0 alerts |
| `510d243` | 39671351888 (green) | 39671351804 | slice 1 done |
| `558708d` | 39672782233 (green) | 39672781338 | Docker job first run |
| `64ad645` | 39674590224 (green, 6 jobs) | 39674590164 (0 results) | README, Pages, release workflows |

The final head adds only these handoff documents and the project brain note; its run ids are reported with the completion message.

## INFERRED (cannot run before merge or tag)

- **Pages returns 200 after merge.** `pages.yml` deploys from `main` when `site/**`, `docs/images/**` or `docs/architecture/**` change, which this merge does. It now also ships `architecture/streaming-request.html`.
- **Tagging `v2.11.0` creates the Latest release from committed notes.** `release.yml` (actionlint-clean) checks the tag against `package.json` (2.11.0), runs the tests, then creates the release from `RELEASE_NOTES_v2.11.0.md` with `--latest`.
- **No extension republish on the tag.** `publish.yml` runs only on `ext-v*` tags or manual dispatch. Its Open VSX step requires `OVSX_PAT`, a matching extension version and a version not already published.
- **No conflicting tag on merge.** `auto-release.yml` only creates `ext-vX.Y.Z` tags. Because the merge touches `CHANGELOG.md`, it may create `ext-v<current extension version>` if that tag is missing; tags pushed with `GITHUB_TOKEN` do not start other workflows.
- **GitHub renders the mermaid diagrams.** Checked with mermaid 10.9.1 locally; GitHub's renderer version may differ.

## Release flow (for the coordinator)

1. Merge `upgrade/v2.11.0` into `main`.
2. Check the "pages" workflow run, then open the website and `/architecture/streaming-request.html` (expect 200).
3. Tag the merge commit and push: `git tag -a v2.11.0 -m "v2.11.0" <merge-sha> && git push origin v2.11.0`.
4. Check the "Release" workflow run: the release `v2.11.0` should use `RELEASE_NOTES_v2.11.0.md` and show as **Latest**.
5. To publish a new status bar extension later, push `ext-vX.Y.Z` or run "Publish Extension" manually (requires `OVSX_PAT`).

The same flow is documented in the README section "Release flow".

## Known limitations

- Live provider access is not tested; fixtures are synthetic.
- `tsc` checks the 15 `@ts-check` modules, not `server.js` / `cloudcode-client.js`.
- The coverage gate covers the core request path; the Perplexity, OAuth, token-extractor and interactive CLI modules need live sessions and are outside it (whole-`src` coverage is lower).
- The terminal demo SVG was recorded at v2.10.0 (50 tests) and is captioned as such.
- The Docker image is not pushed to a registry.
- A pre-existing stray tag `v2.3.0` (created by the old auto-release mapping) is left untouched.

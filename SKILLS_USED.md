# Skills used

Which agent skill drove which change. Skills are the packaged instruction sets available to the coding agent (Claude Code) that did the work.

## v2.11.0

| Skill | Used for | Changes it drove |
|---|---|---|
| `writing-plans` (Superpowers) | Turning the release brief into a task plan before any code | [`docs/superpowers/plans/2026-10-21-v2.11.0-slice1.md`](docs/superpowers/plans/2026-10-21-v2.11.0-slice1.md): module boundaries (`src/resilience/`, `src/http/`), the fixture format, the "Review Focus" edge cases (malformed JSON, 413, 429 + retry-after, upstream hang, secrets in logs) that became tests |
| `test-driven-development` (Superpowers) | Red, then green, for every behaviour change | Each new module (`backoff`, `error-mapper`, `validation`, `metrics`, `shutdown`, `redact`, `model-switch`) has a test that was run failing first. The 30-fixture conformance suite was written before the fixes and failed on exactly the bugs it then pinned (array `system` prompts, `stop_sequences`, tool_result naming, 401 handling, validation). Characterization tests for existing code (account rotation) were checked by a deliberate mutation that made them fail |
| `requesting-code-review` (Superpowers) | One independent review of the slice-1 branch | Four important findings fixed: streaming responses now hold headers until the first upstream event (real status + `retry-after`); non-streaming deadline back to headers-only with at most one timeout retry; `streamStarted` checked first; redaction for Perplexity keys, JWT/cookie tokens and OAuth client secrets, installed before any module loads. Minor findings fixed too (status beats message text, idle-socket sweep, second signal forces exit, aborted requests counted, gitleaks checksum) |
| `verification-before-completion` (Superpowers) | Evidence before every "done" | Each completion claim in [HANDOFF.md](HANDOFF.md) cites a command run or a CI run id; CI logs were read (test counts, coverage numbers, Docker assertions), not just the green status |
| `impeccable` | Refining the GitHub Pages site | [`site/index.html`](site/index.html): kept the existing visual system and added the request/streaming SVG diagram, the verification table (stacks on phones), Docker quickstart and operations section. Themed browser surfaces, raised button text contrast to 4.87:1, fixed stale anchors. The skill's detector reports no findings |
| `archify` | Architecture diagram backed by the code | [`docs/architecture/streaming-request.json`](docs/architecture/streaming-request.json) became [`streaming-request.html`](docs/architecture/streaming-request.html), a sequence diagram pinned to a source revision with line-range evidence for each participant. Passed validate, deliver, provenance check and browser check; published on Pages |

Techniques from other skills, applied without loading the skill text:

- **Systematic debugging** (root cause before fix): the CodeQL `js/clear-text-logging` alerts were traced to CodeQL's name heuristic on `OAUTH_CONFIG`/`oauthFlows`, then fixed by separating the non-secret sign-in settings. The mermaid "Syntax error" was traced to `;` acting as a statement separator. The quadratic model-switch regex was measured (about 0.5 s on 20k spaces) before it was rewritten.
- **Security and hardening**, **CI/CD and automation** and **observability** guidance shaped the redaction, validation, rate limiting, CodeQL/Dependabot/gitleaks setup and the `/metrics` design.

Skills the brief named that were **not** used, and why:

- `brainstorming`: the brief was frozen with explicit acceptance checks, so a plan (`writing-plans`) replaced open-ended ideation.
- `understand` / Understand Anything and `graphify`: large knowledge-graph builders (over 700 lines of instructions each) on a memory-limited machine. `archify` produced the code-backed architecture diagram instead.
- `ui-ux-pro-max`: not loaded. `impeccable` covered the Pages refinement, including its contrast and layout checks.
- `playwright-skill` / `playwright-cli`: headless Chromium was called directly to screenshot the Pages site and to render-check the README mermaid diagrams.
- Caveman and Ponytail: style and terseness modes, not needed for this release.

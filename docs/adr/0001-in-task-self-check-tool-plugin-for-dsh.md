# ADR-0001: In-task Self-Check Tool Plugin for DeepSeek Harness

- **Status:** Accepted
- **Version:** 1.0
- **Date:** 2026-09-18
- **Deciders:** Project owner + advisor session (grilling format)

## Changelog

- **1.0 (2026-09-18):** Grilling round 2 complete (Q1–Q9). Fine-grained design
  settled; implementation may start. Version 1.0 marks the end of the
  design-phase grilling, not a release.
- **0.9 (2026-09-18):** Grilling round 2, Q8 — settled the success criterion:
  harness-side verdict with acceptance-test hash check (§Success verdict).
- **0.8 (2026-09-18):** Grilling round 2, Q7 — settled the calibration corpus
  sourcing strategy (§Calibration corpus).
- **0.7 (2026-09-18):** Grilling round 2, Q6 — settled the model-guidance
  channel: tool description only (§Model guidance).
- **0.6 (2026-09-18):** Grilling round 2, Q5 — settled benchmark metrics and
  repair protocol (§Benchmark protocol).
- **0.5 (2026-09-18):** Grilling round 2, Q4 — settled default command
  pipelines per profile (§Profile pipelines).
- **0.4 (2026-09-18):** Grilling round 2, Q3 — settled report layout and
  truncation priority (§Report layout).
- **0.3 (2026-09-18):** Grilling round 2, Q2 — settled the failure taxonomy
  vocabulary (§Failure taxonomy).
- **0.2 (2026-09-18):** Grilling round 2, Q1 — settled the tool input contract
  (§Tool interface).
- **0.1 (2026-09-18):** Initial decision set from the founding grilling session.
  Later sections are appended (not rewritten) as grilling rounds refine
  details; each accepted round bumps the version by 0.1.

## Success verdict

- After a task ends (agent claims completion or the 3 repair rounds are
  exhausted), the **benchmark harness independently re-runs the task's
  acceptance tests** outside the agent session; the harness exit code decides
  success. Agent-side green reports are never trusted.
- Acceptance test files are hashed before the task starts and compared at
  verdict time; any modification ⇒ automatic failure.
- The verdict path is independent of the plugin (works with the plugin
  missing or never called), so the benchmark measures the tool's net
  contribution.
- Deferred: "self-report vs harness verdict" agreement rate as an honesty
  metric — v2 analytics, underpowered at n=20.

## Benchmark runtime

Benchmark tasks run under the dsh **Minimal** profile (bash + file editor +
the self_debug tool). Minimal is dsh's designated model-benchmark mode; it
removes subagents, web access, and Code Mode so the measured effect is the
structured-diagnosis feedback itself, not the surrounding tool ecosystem.
Real-environment numbers come later from release telemetry, at a sample size
where they are interpretable.

## Inherited without amendment

- Per-command timeout default: 600 000 ms (verify-mcp's value, bounded per
  its config schema).
- Report language: English (project-wide language rule).
- Benchmark task list selection and harness repo layout: implementation
  details, not ADR decisions.

## Calibration corpus

Sourcing: **constructed seed + benchmark-time capture, one issue per tree
defect.**

1. Seed: three small sample projects (node / python / go) into which ~20
   controlled bugs are injected (3–4 per taxonomy class), producing real
   captured command outputs as fixtures. Deterministic, class-balanced,
   available in a day.
2. Growth: the first ~5 benchmark tasks contribute real failure outputs
   (model-made failures differ structurally from hand-made ones — e.g.
   cross-file breakage); they replace or augment constructed samples.
3. Admission rule: a case enters the corpus only if the current decision tree
   classifies it correctly. A misclassification becomes an issue that fixes
   the tree — calibration itself runs as a feedback loop.

## Model guidance

The **tool description is the only guidance channel**. No plugin-registered
system-prompt section, no AGENTS.md edits. The tool carries its own usage
policy: the description must state when to call (before running tests /
claiming a coding step complete), what it returns, and that a failing report
is a normal result.

Consequences:

- Zero prompt pollution; the tool is self-contained like verify-mcp's
  `verify`.
- The description now carries the full policy weight — its wording is a
  benchmark-relevant artifact and gets review before the benchmark runs.
- **Revisit trigger:** if the benchmark shows the model failing to call the
  tool on eligible turns (call-rate materially below 100% of "about to claim
  done" moments), a plugin-registered system-prompt section is added as an
  ADR amendment — dsh's `system-prompt/assemble` waterfall supports this
  without touching user files.

## Benchmark protocol

- **Task set:** 15–20 tasks (HumanEval items with low DeepSeek first-pass rate
  + hand-constructed bugs), per ADR-0001 decision 7.
- **Metrics:**
  1. Task success rate, with-plugin vs. without-plugin
  2. Repair rounds to success/failure
  3. Plugin overhead: extra tokens per task (report enters context) and total
     wall-time delta — reported as "success +X pp, cost +Y tokens/task"
- **Repair protocol (fairness rule):** both arms run the same in-session
  repair loop, max **N = 3** rounds (write → check → fix → re-check).
  The no-plugin arm gets the same retry budget via its own means (re-running
  tests, reading errors). The plugin arm must not get extra rounds; the
  no-plugin arm must not get fewer. N is provisionally 3; adjustable after
  the first 5 tasks, and any change is recorded as an ADR amendment before
  more tasks run.

## Profile pipelines

Default command pipelines are inherited from verify-mcp verbatim:

- **node** (`package.json`): `npm run --if-present lint` → `npm run
  --if-present test` → `npm run --if-present build`
- **python** (`pyproject.toml`): `uv run pytest` → `uv run ruff check .`
- **go** (`go.mod`): `go build ./...` → `go test ./... -count=1` →
  `go vet ./...`

Known risk, accepted by decision: the python pipeline assumes `uv` exists and
the project uses uv workspaces. On non-uv projects every run produces a
guaranteed `environment_error` that is *our* detection coarseness, not a real
project failure — this can pollute the calibration corpus. Profiles are data,
not code: if the calibration corpus shows spurious `environment_error` on
non-uv projects, this is amended by adding marker-differentiated python
sub-profiles (e.g. `uv.lock` vs `requirements.txt`), not by changing the
runner. Revisit trigger: >30% of corpus `environment_error` cases are spurious.

## Report layout

Budget: ~60 lines / 4 KB hard cap (inherited from ADR-0001 decision 5).

- Every **failed** command gets a `Diagnosis: <class> — <hint>` block (hint
  2–4 lines). All failures are diagnosed, not just the first — node+python
  mixed repos legitimately produce two failing profiles in one run.
- When the budget is tight, the raw-output preview shrinks (from 50 lines
  toward ~10) — truncation never touches diagnosis or duration lines.
- Truncation priority, as a hard rule: **hint > duration lines > preview**.
  "What to check next" and "where the time went" are the last things sacrificed;
  the preview (full log is on disk anyway) is the first.
- Diagnosis renders immediately adjacent to the failure output it explains —
  no separate top-level section, so cause and evidence stay connected for the
  model in a single read.

## Failure taxonomy

Six classes, fixed slugs (these become the project glossary seed):

| Slug | Covers |
|---|---|
| `build_error` | Compile, transpile, typecheck failures |
| `assertion_failure` | Test assertion failures, expected ≠ actual |
| `timeout` | Command exceeded `timeoutMs` |
| `environment_error` | Command not found, missing dependency, missing venv/toolchain |
| `permission_error` | EACCES, sandbox denial, file ownership |
| `unknown` | Anything not classifiable into the above — reported honestly |

Rules:

- Classification runs on the failed command's captured output; `unknown` is a
  first-class outcome, never a failure to be forced into a class. A wrong
  hint is more poisonous than no hint.
- Sub-distinctions (e.g. missing tool vs. missing dependency) live in the
  **hint text** of `environment_error`, not in new classes — keeping five
  real classes gives the 20-case calibration corpus ~3–4 samples per class.
- This taxonomy is the toolization of the engineer's triage order: each class
  maps to a fixed next-step investigation hint. The v1 report's "where did
  time go" scope = per-command durations inside the check run; trajectory-
  level time attribution stays deferred to v2 (§Decision 2).

## Tool interface

`self_debug` accepts exactly one optional parameter: `directory?: string` —
the project root to verify; defaults to the harness workspace root. No
command overrides, no profile hints, no scope/fast switches (v2 candidates at
earliest).

Rationale: every extra parameter re-introduces model judgment into a tool
whose acceptance metrics depend on deterministic behavior. Command overrides
were already rejected in favor of auto-detection; a `commands` escape hatch
would silently reopen that decision and confound benchmark attribution.

## Context

Inspired by the GLM-5.3 story (Zhipu's Infra Agent optimizing its own inference
system; "the minimal RSI loop has appeared"), the core insight we want to
productize: the hardest part for an agent is not writing code, but knowing
**where the problem is and what to check next** after a change breaks
something. Senior engineers' troubleshooting methodology should be packaged as
a tool the model itself can call.

The user already runs an agent framework and wants a **plugin** that gives the
model one tool: during a single task (e.g. coding), the model calls it to
discover its own errors and adjust, closing the loop without human help.

### Ecosystem scan (2026-09-18)

Survey of the open-source market found neighbors but no direct equivalent:

| Project | What it is | Gap vs. our concept |
|---|---|---|
| AgentDebugX (arXiv 2607.18754, MIT) | Detect→Attribute→Recover→Rerun closed loop, academic-grade | Heavy, research-oriented; multi-agent attribution focus |
| Raindrop Workshop (MIT) | Local agent debugger + self-healing eval loop with Claude Code/Cursor | Debugs *your business agent*, not the coding agent itself |
| self-healing-agent (DavidSolanas) | LangGraph + E2B sandbox: write→run→read error→fix loop | Tutorial-grade; raw execution feedback only, no attribution |
| verify-mcp (npm) | Single `verify` MCP tool: runs tests/lint/build after edits, returns failure report | **Closest in form.** But "dumb": returns raw stderr, no diagnosis layer; MCP, not a native dsh plugin |
| agent-audits (npm) | Proof-of-done completion gate (criteria→evidence→verdict) | Audits *completion claims*, not in-task self-correction |
| dsh-self-checking-profile | Sandbox preset for dsh (permissions/re-run unlock) | Sandbox mechanics, not a diagnosis tool |
| dsh-plugin-verify / dsh-plugin-check | Claim checking / plugin repo quality gates | Different problem entirely |

**Gap confirmed:** a native DeepSeek Harness (dsh) Cordis plugin that gives the
model a single tool returning *structured diagnosis* (failure class + where to
look next), not just raw error output. dsh's append-only session log is a
future asset for trajectory attribution.

## Decisions

1. **Form:** Native dsh Cordis plugin (npm package with `dsh.bundle.patch`
   manifest), registering one model-visible tool `self_debug`. Not MCP, not a
   hook on the agent loop (dsh is pre-1.0 with breaking changes; a tool is a
   pure increment).
2. **Check target (v1):** The agent's own code changes — is the result correct?
   Trajectory/session-log attribution ("which layer broke, where did time go")
   is deferred to v2.
3. **Verification signal:** The plugin auto-detects the project type and runs
   the matching verification commands. v1 profiles: **node** (`package.json`),
   **python** (`pyproject.toml`), **go** (`go.mod`). Unrecognized project →
   honest "cannot identify project type" failure; never guess.
4. **Diagnosis layer (the differentiator):** Structured attribution over the
   raw failure output: failure taxonomy (initial set: compile error / assertion
   failure / timeout / missing environment / permission) + a fixed
   next-step-investigation suggestion per class (engineer's triage order,
   encoded as a decision tree).
   - Seeded with the generic classification (ship fast), then calibrated
     against ~20 real failure cases and informed by AgentDebugX's failure
     taxonomy (adapted, not copied — theirs targets multi-agent attribution).
5. **Output contract:** Pure-text, deterministic, pure-function style — same
   input yields same report, no hidden state. Hard cap ~60 lines / 4 KB;
   overflow is truncated and the full log is written to a temp file whose path
   is returned in the report (verify-mcp-proven pattern).
6. **Architecture:** Core logic (detect → execute → classify → report) is a
   dependency-free TypeScript module; the dsh plugin is a thin shell around it.
   Keeps the core portable if we ever target another harness.
7. **Acceptance gate:** Benchmark of 15–20 coding tasks (HumanEval items with
   low DeepSeek first-pass rate + hand-constructed bugs). Measure task success
   rate and repair-round count, with-plugin vs. without-plugin. **No publish
   before these numbers exist.**
8. **Publishing:** DSH Hub Workshop + dshbase directory, after acceptance
   numbers pass.
9. **Project language:** English throughout (code, docs, issues, ADRs).

## Naming

`dsh-self-debug`. Chosen over `dsh-self-check` to avoid confusion with the
existing `dsh-self-checking-profile` plugin. Tool name exposed to the model:
`self_debug`.

## Non-goals (v1)

- Trajectory / session-log-based attribution (v2; dsh `session_event_*` tools
  make this tractable later)
- Automatic post-edit triggering via agent-loop hooks
- LLM-judge code review as a signal
- Micro-benchmark / metric feedback (time, throughput) for optimization tasks
- Language profiles beyond node/python/go

## Consequences

- We depend on a fast-moving pre-1.0 framework (dsh v0.1.5-rc line);
  adaptation cost is accepted and limited to the plugin shell.
- The diagnosis decision tree is the project's core IP and must be
  test-covered: every failure class needs fixture cases.
- The acceptance benchmark must be built before the tool is "finished" —
  it defines what finished means.

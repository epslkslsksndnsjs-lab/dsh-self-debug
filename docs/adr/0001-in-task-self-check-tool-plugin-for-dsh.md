# ADR-0001: In-task Self-Check Tool Plugin for DeepSeek Harness

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** Project owner + advisor session (grilling format)

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

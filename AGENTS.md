# AGENTS.md — dsh-self-debug

A native DeepSeek Harness (dsh) plugin that gives the model one tool,
`self_debug`, to discover and diagnose its own errors within a single task.
English is the project language for all code, docs, issues, and ADRs.

Read `docs/adr/` before working in any area — ADR-0001 holds the foundational
product decisions.

## Agent skills

### Issue tracker

GitHub Issues in this repo, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

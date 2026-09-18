# self_debug — Tool Description

**approved by owner 2026-09-18**

This text is the verbatim, owner-approved tool description. It is the **sole
model-guidance channel** for the `self_debug` tool per ADR-0001 (§Model
guidance): no plugin-registered system-prompt section, no AGENTS.md edits. The
plugin shell (`dsh/index.ts`) embeds this string verbatim as the tool
`description`. Do not change a single word without owner re-approval.

---

self_debug — Verify your own code changes before claiming progress.

Call this tool when you have just created or modified code and are about to (a) run tests or (b) report a coding step or task as complete or working. It detects the project type (node / python / go) from marker files, runs the project's verification pipeline (lint, tests, build), and returns a pure-text report. Every failed command comes with a structured diagnosis: a failure class (build_error, assertion_failure, timeout, environment_error, permission_error, or unknown) and a fixed next-step investigation hint, plus per-command durations showing where time went.

A failing report is a NORMAL result, not an error: read the diagnosis, fix the code, and call again. Do not state that a coding change works, passes, or is done unless a self_debug report shows all checks passed.

Parameters:
- directory (optional, string): project root to verify. Defaults to the current workspace root.

The report is capped (~60 lines / 4 KB). When output is truncated, the full log path is included — read it only if the diagnosis is not enough. If the project type cannot be identified, the report says so honestly; do not guess verification commands.

# Reference Analysis: verify-mcp (v0.1.0)

- **Date:** 2026-09-18
- **Source:** npm tarball `verify-mcp@0.1.0` (no GitHub repo declared in
  metadata), extracted at `.scratch/reference/verify-mcp/` (gitignored)
- **Purpose:** ADR-0001 selected verify-mcp as the closest existing form to our
  `self_debug` tool. This note records how it works and what we keep, change,
  and add. License: MIT.

## How it works

Six small modules; the MCP SDK only touches `index.js` (server bootstrap) and
`handler.js` (tool entry). Everything else is framework-free pure logic —
which is exactly the "portable core + thin shell" split ADR-0001 decision 6
mandated.

### config.js — profiles as data

- `SEED` config: five profiles (go/python/node/rust/java), each = `markers`
  (files whose existence in project root selects the profile) + `commands`
  (verification pipeline). Auto-written on first run to
  `~/.config/verify-mcp.json`, overridable via env var.
- Zod validation exists for one subtle reason: a malformed `commands` value
  would otherwise be executed **one character at a time** by `sh -c`, and
  `setTimeout` silently clamps out-of-range delays, so `timeoutMs` is bounded
  to `2^31-1`.

### runner.js — the execution core (the valuable part)

Craft details worth inheriting:

1. `spawn("sh", ["-c", cmd], { detached: true })` + `process.kill(-pid)` —
   timeouts kill the whole **process group**, so grandchildren can't outlive
   the command.
2. Resolve the promise on `exit`, **not** `close` — `close` also waits on
   inherited pipe holders, so a lingering grandchild would block a passing
   command until the timeout and mis-report it. A `setImmediate` before
   finishing lets queued stdout/stderr events flush first.
3. stdout+stderr captured **interleaved** in a chunk ring buffer capped at
   8 MB (runaway log spew can't grow memory unbounded), decoded **once** at
   the end so a multi-byte UTF-8 sequence split across chunks isn't corrupted.
4. `truncateTail(output, 50 lines, 8192 bytes)` — keeps the **tail** (last
   50 lines), caps in the **byte domain** (bytes ≠ UTF-16 code units).
5. Stop at first failing command; remaining commands are recorded as
   `skipped`, not silently dropped.
6. On truncation, full output is written best-effort to a `mkdtemp` dir; the
   path goes into the result. A filesystem error there must **not** upgrade a
   normal failed-check into an `isError` response.

### report.js — deterministic pure-text rendering

Fixed-shape report: `verify: FAILED — go` header, per-profile sections with
`(ran/total)` counts where `ran` excludes skipped commands, per-command lines
(`✓ cmd 1.2s` / `✗ cmd exit 1, 3.4s (timeout)` / `⏭ skipped after failure`),
fenced preview block, and `[truncated N lines → /tmp/verify-mcp-x/y.log]`.
Pure function: same results → same text, byte for byte.

### handler.js — failure semantics

A failing check is a **normal result** (plain text). `isError: true` is
reserved for infrastructure failures: directory doesn't exist, config invalid.
This matches our ADR-0001 "honest failure" stance.

## What it does NOT have (our differentiator)

Zero attribution. The model gets raw tail output and must figure out the
failure class and next step itself. No failure taxonomy, no per-class
investigation hints, no dsh integration. That gap is precisely ADR-0001
decision 4.

## Adoption plan for dsh-self-debug

- **Inherit** ( MIT, with attribution): process-group runner, exit-not-close
  resolution, interleaved capture with ring buffer, tail truncation + temp
  log dir, stop-at-first-failure, marker-based profile detection, seeded
  config, normal-result-vs-isError semantics.
- **Change:** profiles reduced to node/python/go (ADR-0001 decision 3) with
  our own defaults; report gains a diagnosis section (see below); config
  schema owned by our plugin (no first-run write to user home — dsh plugin
  conventions differ).
- **Add (the differentiator):** a `diagnose` module between runner and
  report: classify each failed command's output into the ADR taxonomy
  (compile error / assertion failure / timeout / missing environment /
  permission), attach the class's next-step investigation hints, keep the
  whole report under ~60 lines / 4 KB. Taxonomy calibrated against ~20 real
  failure cases (next work item) and informed by AgentDebugX's taxonomy.

## Ecosystem check (subagent findings, same day)

- **dsh official repo:** no model-visible tool runs project verification with
  failure attribution. `self_check`/`self-debug` zero hits; closest are
  `tool-lsp` (LSP diagnostics only) and the official-side `dsh-tool-diagnose`
  (which diagnoses DSH runtime internals — tools/credentials/approvals — not
  user code).
- **Official docs/Discussions:** no roadmap item for this.
- **Community catalogs (dshbase, dsh.so, DSH Hub Workshop):** nearest are
  `dsh-lsp-actions` (LSP diagnostics only), `dsh-doublecheck` (engineering-
  discipline prompt bundle, no deterministic command execution), `dsh-fail-logger`
  (log capture), `dsh-llm-verifier` (LLM-judged verification). None combines
  detect + run + structured attribution.

**Conclusion: the niche is empty. Proceed per ADR-0001.**

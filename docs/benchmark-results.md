# Benchmark Results — dsh-self-debug (T9, issue #10)

> ## ⚠️ PENDING RUN — DO NOT TREAT AS DATA
>
> This document is a **scaffold**. Every number below is a `___` placeholder.
> No benchmark has been executed yet because `DEEPSEEK_API_KEY` is unavailable
> in the build environment and the task forbids fabricating results. The real
> numbers are populated **only** by running the benchmark with a valid key
> (command in `docs/...` / `README`), then re-running the aggregator and
> filling the placeholders. Until then this file contains **zero real data**.

## Run provenance (fill at run time)

| Field | Value |
|---|---|
| Model | `___` (e.g. `deepseek-chat`) |
| Date | `___` (YYYY-MM-DD) |
| Tasks executed (N) | `___` (target 15–20; go tasks recorded as skipped if toolchain absent) |
| Git SHA | `___` |
| `DEEPSEEK_API_KEY` present | `___` (boolean flag only — the key value is never recorded) |
| Records directory | `___` (per-task JSON + `manifest.json`) |

## Conclusion (ADR-0001 mandated shape)

> Format: **success +X pp, cost +Y tokens/task** (ADR §Benchmark protocol).

- **Success rate delta:** `+___ pp` (plugin `___%` vs plain `___%`; `successRateDeltaPp`)
- **Repair rounds to success:** plugin `___` avg (range `___`), plain `___` avg (range `___`)
- **Repair rounds to failure:** plugin `___` avg, plain `___` avg
- **Plugin overhead — tokens:** `+___ tokens/task` (plugin `___` avg vs plain `___` avg total tokens)
- **Plugin overhead — wall time:** `+___ ms` total wall-time delta (plugin `___` avg vs plain `___` avg)
- **Tool call-rate (plugin arm):** `___` of `___` eligible "about to claim done" turns → `___%`
- **Revisit trigger (ADR §Model guidance):** `___FIRED / NOT FIRED___`
  - If fired: a plugin-registered system-prompt section is to be added as an ADR-0001 amendment (dsh `system-prompt/assemble` waterfall).
- **Skipped tasks:** `___` (list with reasons; go tasks require the go toolchain)

## Raw records

- Per-task JSON records: `___/ <taskId>-plugin.json`, `<taskId>-plain.json`, `<taskId>-skipped.json`
- Run manifest: `___/manifest.json`
- Aggregated conclusion (machine-readable): produced by
  `node --experimental-strip-types benchmark/aggregate.ts --dir <records-dir>`

## Methodology

1. **Harness:** `benchmark/harness.ts` copies each task's scaffold into an
   isolated temp workspace, hashes the acceptance-test files, runs up to
   `MAX_ROUNDS = 3` in-session repair rounds via the agent driver, then
   **independently** re-hashes the acceptance files and re-runs the task's
   acceptance command. The harness exit code — not the agent's "done" claim —
   decides success. Any acceptance-file modification forces failure through the
   hash guard. (See ADR-0001 §Success verdict.)
2. **Arms:** `plugin` (self_debug tool registered via the repo's plugin shell,
   dsh Minimal profile) vs `plain` (same profile, tool **not** registered).
   Both arms share the identical repair loop and budget — fairness rule.
3. **Driver:** `benchmark/drivers/dsh.ts` shells out to `npx @deepseek-ai/dsh`
   running the Minimal profile, one dsh session per repair round, inside the
   task workspace, with a 10-minute killable per-round timeout. `DEEPSEEK_API_KEY`
   is read from the environment at run time, never hardcoded.
4. **Call-rate accounting:** the plugin arm's in-session `self_debug` calls
   cannot be intercepted by the harness, so they are counted from the dsh
   session transcript together with "about to claim done" moments (eligible
   turns). The parser is best-effort and unit-tested against fixture
   transcripts; see `benchmark/drivers/dsh.ts` for the assumed log grammar and
   its TODO.
5. **Aggregation:** `benchmark/aggregate.ts` reads the records directory and
   computes the conclusion shape above; skipped tasks are excluded from the
   success-rate/overhead math but listed under "Skipped tasks".
6. **Calibration feedback:** per ADR-0001 §Calibration corpus, any task the
   harness judges as a real failure that the decision tree misclassifies
   becomes a calibration issue (not silently dropped). Record such cases here:
   `___`.

## Known offline-determination gaps (must be resolved before trusting real numbers)

- **Exact dsh CLI flag for plugin registration** (`DSH_PLUGIN_ARGS` in
  `benchmark/drivers/dsh.ts`) is a best-supported guess (`--plugin
  dsh-self-debug`). The `@deepseek-ai/dsh` CLI was not installed in the build
  environment and running it to discover the flag is forbidden. Replace with
  the verified flag (and update `buildDshArgs`) once the CLI is available.
- **Session-log grammar** assumed by `parseTranscript` is undocumented
  offline; the real format may differ, which would change parsed call-rate and
  token figures. Validate against a real session log before interpreting.

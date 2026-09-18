# Failure taxonomy glossary (seed)

The glossary seed for the in-task self-check tool (ADR-0001 §Failure taxonomy;
issue #5). These six fixed slugs and their fixed 2–4 line hints are the
tool's diagnosis vocabulary. The classifier (`src/diagnosis.ts`) maps a failed
command's captured output to exactly one slug; `unknown` is a first-class
outcome and is never a forced fallback.

The hints encode the engineer's triage order — each class maps to a fixed
next-step investigation suggestion. Sub-distinctions (e.g. missing tool vs.
missing dependency) live in the **hint text**, not in additional classes, to
keep ~3–4 calibration samples per real class.

## Slugs

| Slug | Covers | Fixed hint (2–4 lines, engineer's triage order) |
|---|---|---|
| `build_error` | Compile, transpile, typecheck failures | Compilation, transpile, or typecheck failed before any test ran.<br>Read the error location (file:line) and fix the type/syntax issue.<br>Re-run the build step in isolation to confirm it resolves. |
| `assertion_failure` | Test assertion failures, expected ≠ actual | A test assertion failed: actual output diverged from expected.<br>Inspect the failing assertion and the diff between expected and actual.<br>Re-run the single test to confirm the exact mismatch. |
| `timeout` | Command exceeded `timeoutMs` | The command exceeded its execution-time budget (or a test timed out).<br>Check for deadlocks, unbounded loops, slow I/O, or raise the timeout.<br>Re-run with a longer timeout or narrower scope to isolate the hang. |
| `environment_error` | Command not found, missing dependency, missing venv/toolchain | A required tool, binary, or dependency was missing (command not found / ENOENT / ModuleNotFound).<br>Step 1 — missing tool: the command itself was not found; install it or add it to PATH.<br>Step 2 — missing dependency: the tool ran but a module/package was unresolved; install deps (uv / venv / go mod). |
| `permission_error` | EACCES, sandbox denial, file ownership | The command was denied by the filesystem or sandbox (EACCES / permission denied).<br>Check file/directory ownership and whether the sandbox allows the path.<br>Relax the permission, move the target to a writable path, or run with rights. |
| `unknown` | Anything not classifiable into the above — reported honestly | The failure matched no known class; the captured output is the evidence.<br>Read the full log on disk to identify the root cause directly.<br>If a pattern recurs, file an issue to extend the decision tree. |

## Notes

- Classification runs on the failed command's captured output. `unknown` is a
  first-class outcome, never a failure to be forced into a class — a wrong hint
  is more poisonous than no hint.
- The calibration corpus (`corpus/`) admits captured-output fixtures (including
  python/go text fixtures that need no real `go`/`uv` install) and gates the
  tree: every admitted case is one assertion, and any regression turns the gate
  red. See `corpus/README.md`.

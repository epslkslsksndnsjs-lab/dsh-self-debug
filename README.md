# dsh-self-debug

A native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh) plugin that gives the model one tool — `self_debug` — to discover and
diagnose its own errors within a single task: detect project type, run the
matching verification commands, and return a deterministic, pure-text report
with structured attribution (failure class + next-step investigation hints),
not just raw error output.

Status: design phase. See [ADR-0001](docs/adr/0001-in-task-self-check-tool-plugin-for-dsh.md)
for the full decision record. No marketplace publish before the acceptance
benchmark (with-plugin vs without-plugin task success rate) produces numbers.

## Architecture

The core logic (`detect → execute → classify → report`) is a dependency-free
TypeScript module under `src/`. The dsh plugin shell (which registers the
`self_debug` tool with the harness) is a thin adapter around this core and is
the only component that touches dsh APIs.

```
src/
  profiles.ts   # profile data (node / python / go) + marker-file detection
  runner.ts     # sequential pipeline execution; resolves on process exit
  reporter.ts   # deterministic pure-text report rendering
  self-debug.ts # top-level entry point: { directory? } -> report text
test/
  fixtures/     # minimal offline node projects used by the test suite
```

## Core entry point

```ts
import { selfDebug } from './src/self-debug.ts';

const report: string = await selfDebug({ directory: './some/project' });
```

- `directory` is optional and defaults to the current working directory.
- Project type is auto-detected from marker files: `package.json` (node),
  `pyproject.toml` (python), `go.mod` (go).
- An unrecognized project yields an honest `cannot identify project type`
  response listing the known markers — never a guessed pipeline.
- The report is deterministic and free of hidden state. The duration-free
  report shapes (e.g. `cannot identify project type`) are byte-identical for the
  same input across runs. Per-command durations are real wall-clock values
  rendered at a fixed width, so timed reports are byte-length-stable and
  identical once the variable duration tokens are removed.

## Profiles (pipelines inherited from verify-mcp)

| Profile | Marker        | Pipeline                                                       |
|---------|---------------|---------------------------------------------------------------|
| node    | `package.json`| `npm run --if-present lint` → `test` → `build`               |
| python  | `pyproject.toml` | `uv run pytest` → `uv run ruff check .`                  |
| go      | `go.mod`      | `go build ./...` → `go test ./... -count=1` → `go vet ./...` |

The runner executes the pipeline in order and stops at the first failing
command; the remaining commands are recorded as `skipped`.

## Development

```sh
npm install      # dev dependencies only (vitest, typescript)
npm test         # vitest run — CI-consumable, no network required
npm run typecheck
```

The test suite exercises only externally observable behaviour: the returned
report text (byte-stable across runs) and real subprocess behaviour (the runner
resolves on process `exit`, not on pipe `close`). Fixture projects under
`test/fixtures/` run fully offline.

## Install into a dsh profile

This package is a native dsh (DeepSeek Harness) Cordis plugin. Add it to a
local or remote dsh profile with the harness CLI:

```sh
dsh plugin --profile <name> add github:epslkslsksndnsjs-lab/dsh-self-debug
```

After install, a dsh session in that profile sees and can invoke the
`self_debug` tool. The plugin is registered through the harness tool registry
via `cordis.patch.yml` (`dsh.bundle.patch` in `package.json`); no AGENTS.md or
system-prompt section is touched — the tool description is the sole
model-guidance channel (ADR-0001, §Model guidance).

## License

MIT

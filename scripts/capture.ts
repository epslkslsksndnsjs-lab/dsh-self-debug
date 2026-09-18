// Corpus capture helper (issue #8 / T7). Runs a single command through the
// REAL hardened runner (src/runner.ts) and prints the captured output verbatim
// to stdout, so it can be redirected into a corpus case's output.txt.
//
// The runner is the same code path the self_debug tool uses in production, so
// the captured text is exactly what the classification decision tree sees. For
// the timeout class, pass a `timeoutMs` so the runner SIGKILLs the process
// group (run with a `sleep`/long-running command) and the captured output is a
// genuine timeout output.
//
// Usage:
//   node --experimental-strip-types scripts/capture.ts "<cmd>" <cwd> [timeoutMs]
//
// Real node bugs are captured by running the project's npm scripts directly.
// Python/go bugs are captured by prepending a fake `uv`/`go` onto PATH (the
// fake tool emits the controlled output) and running the real profile command.

import { runCommand } from '../src/runner.ts';

const [cmd, cwd, timeoutMsArg] = process.argv.slice(2);
if (!cmd || !cwd) {
  console.error('usage: capture.ts "<cmd>" <cwd> [timeoutMs]');
  process.exit(2);
}
const timeoutMs = timeoutMsArg ? Number(timeoutMsArg) : undefined;

const result = await runCommand({ run: cmd, label: cmd }, 0, {
  cwd,
  timeoutMs: timeoutMs && timeoutMs > 0 ? timeoutMs : undefined,
});
process.stdout.write(result.output);
if (process.env.DSH_CAPTURE_DEBUG) {
  process.stderr.write(`[capture] status=${result.status} exit=${result.exitCode} timedOut=${!!result.timedOut} bytes=${result.output.length}\n`);
}

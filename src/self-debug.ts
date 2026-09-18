import { existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { detectProfile } from './profiles.ts';
import { runPipeline, type CommandResult } from './runner.ts';
import { renderReport, renderUnknown } from './reporter.ts';

export interface SelfDebugOptions {
  /** Project root to verify. Defaults to the current working directory. */
  directory?: string;
  /**
   * Injectable clock (test hook). With a fixed clock the report is
   * byte-identical across runs — "same inputs, same bytes".
   */
  now?: () => number;
  /**
   * Per-command timeout in milliseconds (runner process hardening, T3). Off
   * when unset — the runner then relies on the child exiting on its own.
   */
  timeoutMs?: number;
  /**
   * Hard cap on captured output bytes per command (runner ring buffer). Off
   * when unset (default 8 MiB in the runner).
   */
  maxOutputBytes?: number;
}

/**
 * Deterministic temp-log path for a failed command. Derived from a stable hash
 * of the project directory plus the pipeline index, so two runs of the same
 * directory produce byte-identical report paths (determinism contract).
 */
function failureLogPath(directory: string, index: number): string {
  const hash = createHash('sha1').update(resolve(directory)).digest('hex').slice(0, 12);
  return join(tmpdir(), `dsh-log-${hash}-${index}.log`);
}

/** Persist the full (untruncated) output of a failed command to a temp file. */
function persistFailureLogs(directory: string, results: CommandResult[]): void {
  for (const r of results) {
    if (r.status === 'fail' && r.output.length > 0) {
      r.logPath = failureLogPath(directory, r.index);
      writeFileSync(r.logPath, r.output, 'utf8');
    }
  }
}

/**
 * Top-level, framework-free entry point. Detects the project type from marker
 * files, runs the matching verification pipeline, and returns a deterministic
 * pure-text report. An unrecognized project yields the honest cannot-identify
 * response — never a guessed pipeline. A failing check is a normal result
 * (diagnosed, not thrown); only an unidentifiable directory is an error-class
 * response (ADR-0001).
 */
export async function selfDebug(options: SelfDebugOptions = {}): Promise<string> {
  const directory = resolve(options.directory ?? process.cwd());

  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return renderUnknown(directory);
  }

  const profile = detectProfile(directory);
  if (!profile) {
    return renderUnknown(directory);
  }

  const results = await runPipeline(profile, {
    cwd: directory,
    now: options.now,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
  });
  persistFailureLogs(directory, results);
  return renderReport({ profile, results, directory });
}

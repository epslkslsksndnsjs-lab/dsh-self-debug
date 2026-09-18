import { spawn } from 'node:child_process';
import type { Command, Profile } from './profiles.ts';

export type CommandStatus = 'pass' | 'fail' | 'skip';

export interface CommandResult {
  /** Zero-based index in the pipeline. */
  index: number;
  label: string;
  run: string;
  status: CommandStatus;
  /** Process exit code; null for skipped commands. */
  exitCode: number | null;
  /** Captured stdout/stderr (interleaved). */
  output: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

export interface RunOptions {
  cwd: string;
}

/**
 * Run a single command. Resolves on the child `exit` event — NOT on the
 * stdout/stderr pipe `close` event — so a lingering grandchild holding the
 * pipe open cannot block resolution. Durations are measured from spawn to exit.
 */
export function runCommand(
  cmd: Command,
  index: number,
  options: RunOptions,
): Promise<CommandResult> {
  const start = Date.now();
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(cmd.run, [], {
      cwd: options.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('exit', (code) => {
      resolve({
        index,
        label: cmd.label,
        run: cmd.run,
        status: code === 0 ? 'pass' : 'fail',
        exitCode: code,
        output,
        durationMs: Date.now() - start,
      });
    });
  });
}

/**
 * Run the profile pipeline in order. Stops at the first failing command and
 * records the remaining commands as `skip`. (Process hardening — timeout /
 * process-group kill — is intentionally out of scope for this ticket, T3.)
 */
export async function runPipeline(
  profile: Profile,
  options: RunOptions,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (let i = 0; i < profile.pipeline.length; i++) {
    const cmd = profile.pipeline[i]!;
    const result = await runCommand(cmd, i, options);
    results.push(result);
    if (result.status === 'fail') {
      for (let j = i + 1; j < profile.pipeline.length; j++) {
        const skipped = profile.pipeline[j]!;
        results.push({
          index: j,
          label: skipped.label,
          run: skipped.run,
          status: 'skip',
          exitCode: null,
          output: '',
          durationMs: 0,
        });
      }
      break;
    }
  }
  return results;
}

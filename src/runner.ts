import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import type { Command, Profile } from './profiles.ts';
import { diagnose, type Diagnosis } from './diagnosis.ts';

export type CommandStatus = 'pass' | 'fail' | 'skip';

export interface CommandResult {
  /** Zero-based index in the pipeline. */
  index: number;
  label: string;
  run: string;
  status: CommandStatus;
  /** Process exit code; null for skipped commands and for timeouts. */
  exitCode: number | null;
  /** Captured stdout/stderr (interleaved, decoded once at resolution). */
  output: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Diagnosis for failed commands (ADR-0001 decision tree). Absent on pass/skip. */
  diagnosis?: Diagnosis;
  /** Path to the temp file holding the full (untruncated) output. Set by the caller. */
  logPath?: string;
  /** True when the command was terminated by the runner's timeout (process group killed). */
  timedOut?: boolean;
}

export interface RunOptions {
  cwd: string;
  /**
   * Injectable clock (test hook). Production callers omit it and get
   * Date.now; tests pass a fixed clock so reports are byte-identical,
   * satisfying the "same inputs, same bytes" contract without weakening it.
   */
  now?: () => number;
  /**
   * Per-command timeout in milliseconds. When exceeded the entire process
   * group is SIGKILLed so no grandchild survives the timeout. Off when unset/0.
   */
  timeoutMs?: number;
  /**
   * Hard cap on captured output bytes. A ring buffer drops the oldest bytes
   * once exceeded, so the tail is always kept and memory stays bounded under
   * log spew. Default 8 MiB.
   */
  maxOutputBytes?: number;
}

/** Default captured-output cap (ADR-0001: bounded, tail-kept ring buffer). */
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Decode the accumulated byte chunks exactly once, at resolution time. Decoding
 * the whole buffer (not each chunk) keeps a multi-byte UTF-8 sequence that the
 * OS split across two `data` chunks from corrupting into replacement chars.
 */
function decodeOutput(chunks: Buffer[], byteLength: number): string {
  if (chunks.length === 0) return '';
  return Buffer.concat(chunks, byteLength).toString('utf8');
}

/**
 * Ring-buffer cap: drop the oldest bytes so the total stays within `cap`,
 * keeping the tail. Whole oldest chunks are discarded first; a partial overflow
 * trims the head of the first chunk. Any leading UTF-8 continuation byte left
 * at the new head is stripped so the decoded tail starts on a character
 * boundary (no mid-character corruption).
 */
function enforceOutputCap(chunks: Buffer[], state: { bytes: number }, cap: number): void {
  while (chunks.length > 1 && state.bytes - chunks[0]!.length >= cap) {
    state.bytes -= chunks[0]!.length;
    chunks.shift();
  }
  if (state.bytes > cap) {
    const overflow = state.bytes - cap;
    const first = chunks[0]!;
    const trimmed = first.subarray(overflow);
    chunks[0] = trimmed;
    state.bytes -= overflow;
  }
  const head = chunks[0]!;
  if (head.length > 0 && (head[0]! & 0xc0) === 0x80) {
    let i = 0;
    while (i < head.length && (head[i]! & 0xc0) === 0x80) i++;
    chunks[0] = head.subarray(i);
    state.bytes -= i;
  }
}

/**
 * Run a single command. Resolves on the child `exit` event — NOT on the
 * stdout/stderr pipe `close` event — so a lingering grandchild holding the
 * pipe open cannot block resolution. Durations are measured from spawn to exit.
 *
 * The child is spawned `detached` so it leads its own process group; a timeout
 * SIGKILLs the whole group (`-pid`), ensuring grandchildren cannot outlive the
 * timeout. Output is captured into byte chunks in arrival order (stdout/stderr
 * interleaved) and decoded once at resolution.
 */
export function runCommand(
  cmd: Command,
  index: number,
  options: RunOptions,
): Promise<CommandResult> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const start = now();
  // Only detach (and thus form an independent process group) when a timeout is
  // configured: the group is what lets a timeout SIGKILL the whole subtree.
  // Non-timeout runs keep the original non-detached spawn, so existing
  // (passing/quick) behavior is untouched.
  const detached = !!(timeoutMs && timeoutMs > 0);

  return new Promise<CommandResult>((resolve) => {
    const child = spawn(cmd.run, [], {
      cwd: options.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
    });
    const pid = child.pid;

    const chunks: Buffer[] = [];
    const state = { bytes: 0 };
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      state.bytes += chunk.length;
      if (state.bytes > maxBytes) enforceOutputCap(chunks, state, maxBytes);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const resolveOnce = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    child.on('exit', (code) => {
      if (settled) return;
      const output = decodeOutput(chunks, state.bytes);
      const status: CommandStatus = code === 0 ? 'pass' : 'fail';
      resolveOnce({
        index,
        label: cmd.label,
        run: cmd.run,
        status,
        exitCode: code,
        output,
        durationMs: now() - start,
        diagnosis: status === 'fail' ? diagnose(output) : undefined,
      });
    });

    if (timeoutMs && timeoutMs > 0 && pid != null) {
      timer = setTimeout(() => {
        const output = decodeOutput(chunks, state.bytes);
        // Kill the whole process group so no grandchild survives the timeout.
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // The group may already be gone; ignore ESRCH.
        }
        resolveOnce({
          index,
          label: cmd.label,
          run: cmd.run,
          status: 'fail',
          exitCode: null,
          output,
          durationMs: now() - start,
          timedOut: true,
          diagnosis: diagnose('timed out'),
        });
      }, timeoutMs);
    }
  });
}

/**
 * Run the profile pipeline in order. Stops at the first failing command and
 * records the remaining commands as `skip`.
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

// Benchmark harness core (T8, issue #9).
//
// Drives one task under one arm: copies the scaffold into a temp workspace,
// hashes the acceptance-test files BEFORE the agent runs, runs up to N=3
// in-session repair rounds via the supplied driver, then — independently of
// anything the agent reported — re-hashes the acceptance files and re-runs the
// task's acceptance command itself. The acceptance exit code decides success.
// The agent's own "done" claim is never trusted; a modified acceptance file
// forces failure through the hash guard regardless of the acceptance result.
//
// The harness reuses the production self_debug core (src/self-debug.ts) for the
// plugin arm's tool calls and the hardened runner (src/runner.ts) for the
// independent acceptance command, so the path exercised here is the same code
// T9's real model would touch.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, accessSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { selfDebug } from '../src/self-debug.ts';
import { runCommand } from '../src/runner.ts';
import type { AgentDriver, BenchmarkTask, DriverContext, TaskRecord, TokenAccount } from './types.ts';

/** Equal in-session repair budget for BOTH arms (ADR-0001 §Benchmark protocol). */
export const MAX_ROUNDS = 3;

export interface HarnessOptions {
  /** Override the repair budget (defaults to MAX_ROUNDS). */
  maxRounds?: number;
  /** Injectable clock (test hook for deterministic wall time). */
  now?: () => number;
}

/** Create an isolated temp workspace directory for one task run. */
export function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-bench-'));
}

/** Materialise a scaffold (relative path -> content) into `dir`, making dirs. */
export function writeScaffold(dir: string, scaffold: Record<string, string>): void {
  for (const [rel, content] of Object.entries(scaffold)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}

/** sha256 of each acceptance file's content, keyed by relative path. */
export function hashAcceptanceFiles(dir: string, files: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of files) {
    const full = join(dir, rel);
    if (!existsSync(full)) {
      out[rel] = '<MISSING>';
      continue;
    }
    out[rel] = createHash('sha256').update(readFileSync(full, 'utf8')).digest('hex');
  }
  return out;
}

function diffHashes(
  a: Record<string, string>,
  b: Record<string, string>,
): { equal: boolean; changed: string[] } {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) changed.push(k);
  }
  return { equal: changed.length === 0, changed };
}

/**
 * True when `bin` resolves on the current PATH (honours DSH_NODE_BIN_DIR /
 * the node bin dir prepended by the CLI). Used to decide whether a task's
 * acceptance command can actually run in this environment.
 */
export function commandExists(bin: string): boolean {
  const path = process.env.PATH ?? '';
  const sep = path.includes(';') ? ';' : ':';
  for (const dir of path.split(sep)) {
    if (!dir) continue;
    for (const candidate of [join(dir, bin), join(dir, `${bin}.exe`)]) {
      try {
        accessSync(candidate);
        return true;
      } catch {
        // not at this path element; keep scanning.
      }
    }
  }
  return false;
}

/**
 * Decide whether a task should be SKIPPED rather than executed: a task whose
 * acceptance command cannot run in this environment (e.g. a go task when the go
 * toolchain is absent) is recorded as skipped with a reason so the manifest
 * stays honest. We skip when either (a) the task author flagged it
 * `offlineRunnable: false`, or (b) the acceptance command's binary is not on
 * PATH — both make a real verdict impossible here.
 */
export function detectSkip(task: BenchmarkTask): { skip: boolean; reason?: string } {
  const bin = task.acceptanceCommand.trim().split(/\s+/)[0] ?? '';
  if (task.offlineRunnable === false) {
    return {
      skip: true,
      reason: `task "${task.id}" (${task.language}) is not offline-runnable in this environment; its acceptance command "${task.acceptanceCommand}" requires a toolchain that is absent. Recorded as skipped (will execute at T9 where the toolchain exists).`,
    };
  }
  if (bin && !commandExists(bin)) {
    return {
      skip: true,
      reason: `acceptance command "${task.acceptanceCommand}" cannot run: "${bin}" is not on PATH. Recorded as skipped.`,
    };
  }
  return { skip: false };
}

/** Build a TaskRecord for a skipped task (no execution, no verdict). */
export function skipRecord(task: BenchmarkTask, reason: string): TaskRecord {
  return {
    taskId: task.id,
    arm: 'plugin',
    driver: 'skipped',
    status: 'skipped',
    skipReason: reason,
    roundsUsed: 0,
    maxRounds: MAX_ROUNDS,
    claimedDone: false,
    eligibleTurns: 0,
    selfDebugCalls: 0,
    callRate: null,
    tokens: { input: null, output: null, source: 'none' },
    wallTimeMs: 0,
    hashModified: false,
    modifiedFiles: [],
    verdict: 'fail',
    verdictReason: 'acceptance',
    acceptanceExitCode: null,
  };
}

/**
 * Run one task under one arm and return its record. The driver is responsible
 * for the in-session repair loop; the harness owns the verdict path (hash guard
 * + independent acceptance) so it cannot be gamed by the driver or the model.
 */
export async function runTask(
  task: BenchmarkTask,
  driver: AgentDriver,
  opts: HarnessOptions = {},
): Promise<TaskRecord> {
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;
  const now = opts.now ?? (() => Date.now());

  // Skip when the task cannot be executed in this environment (e.g. go task,
  // no go toolchain). The manifest stays honest: a skipped task is recorded
  // with a reason and excluded from success-rate accounting. The verdict path
  // is never faked.
  const skip = detectSkip(task);
  if (skip.skip) {
    return { ...skipRecord(task, skip.reason ?? 'skipped'), arm: driver.arm, driver: driver.name };
  }

  const workspace = makeWorkspace();
  writeScaffold(workspace, task.scaffold);

  // Hash guard — capture the acceptance files BEFORE the agent touches anything.
  const pre = hashAcceptanceFiles(workspace, task.acceptanceFiles);

  let eligibleTurns = 0;
  let selfDebugCalls = 0;
  // Real-agent drivers report self_debug calls / token usage observed in the
  // external dsh session transcript (the harness cannot intercept those). These
  // accumulators sum the driver-reported signal so TaskRecord reflects reality
  // for the model driver without double-counting the harness-side counter.
  let driverReportedSelfDebug = 0;
  let driverTokenInput: number | null = null;
  let driverTokenOutput: number | null = null;

  const callSelfDebug: (() => Promise<string>) | null = driver.selfDebugAvailable
    ? async () => {
        selfDebugCalls += 1;
        // Runs the REAL self_debug core against the workspace (same code path a
        // real dsh session would use). Counted above for call-rate accounting.
        return await selfDebug({ directory: workspace });
      }
    : null;

  const markEligibleTurn = (calledSelfDebug: boolean): void => {
    eligibleTurns += 1;
    if (calledSelfDebug && driver.selfDebugAvailable) {
      // already counted via callSelfDebug; nothing extra to record here.
    }
  };

  const start = now();
  let roundsUsed = 0;
  let claimedDone = false;
  for (let round = 1; round <= maxRounds; round++) {
    roundsUsed = round;
    const ctx: DriverContext = {
      arm: driver.arm,
      task,
      workspace,
      round,
      maxRounds,
      callSelfDebug,
      markEligibleTurn,
    };
    const res = await driver.runRound(ctx);
    if (res.selfDebugCalls && res.selfDebugCalls > 0) {
      driverReportedSelfDebug += res.selfDebugCalls;
    }
    if (res.tokens) {
      if (res.tokens.input != null) {
        driverTokenInput = (driverTokenInput ?? 0) + res.tokens.input;
      }
      if (res.tokens.output != null) {
        driverTokenOutput = (driverTokenOutput ?? 0) + res.tokens.output;
      }
    }
    if (res.claimedDone) {
      claimedDone = true;
      break;
    }
  }
  const wallTimeMs = now() - start;

  // Hash guard — re-hash at verdict time. Any change => automatic failure,
  // independent of the acceptance result.
  const post = hashAcceptanceFiles(workspace, task.acceptanceFiles);
  const { equal, changed } = diffHashes(pre, post);
  const hashModified = !equal;

  let verdict: 'pass' | 'fail' = 'fail';
  let verdictReason: TaskRecord['verdictReason'] = 'acceptance';
  let acceptanceExitCode: number | null = null;

  if (hashModified) {
    verdict = 'fail';
    verdictReason = 'hash_modified';
  } else {
    // Independent verdict: the harness re-runs acceptance itself, outside the
    // agent session. The harness exit code decides; agent-side green is ignored.
    const result = await runCommand(
      { run: task.acceptanceCommand, label: task.acceptanceCommand },
      0,
      { cwd: workspace },
    );
    acceptanceExitCode = result.exitCode;
    verdict = result.status === 'pass' ? 'pass' : 'fail';
    verdictReason = 'acceptance';
  }

  // Best-effort cleanup of the temp workspace.
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    // ignore cleanup races
  }

  const callRate = eligibleTurns > 0 ? (selfDebugCalls + driverReportedSelfDebug) / eligibleTurns : null;

  // Token source: 'dsh' when the driver reported model token usage (real run),
  // else 'none' (offline/scripted). Totals accumulate across rounds.
  const tokens: TokenAccount =
    driverTokenInput !== null || driverTokenOutput !== null
      ? { input: driverTokenInput, output: driverTokenOutput, source: 'dsh' }
      : { input: null, output: null, source: 'none' };

  return {
    taskId: task.id,
    arm: driver.arm,
    driver: driver.name,
    status: 'run',
    roundsUsed,
    maxRounds,
    claimedDone,
    eligibleTurns,
    selfDebugCalls: selfDebugCalls + driverReportedSelfDebug,
    callRate,
    tokens,
    wallTimeMs,
    hashModified,
    modifiedFiles: changed,
    verdict,
    verdictReason,
    acceptanceExitCode,
  };
}

/**
 * Run a task under BOTH arms with the same repair budget and return both
 * records. The plain arm must get no fewer rounds and the plugin arm no extra
 * (fairness rule); this is guaranteed because both arms share the identical
 * loop in runTask with the same maxRounds.
 */
export async function runDualArm(
  task: BenchmarkTask,
  pluginDriver: AgentDriver,
  plainDriver: AgentDriver,
  opts: HarnessOptions = {},
): Promise<{ plugin: TaskRecord; plain: TaskRecord }> {
  const plugin = await runTask(task, pluginDriver, opts);
  const plain = await runTask(task, plainDriver, opts);
  return { plugin, plain };
}

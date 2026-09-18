// Benchmark results aggregator (T9, issue #10).
//
// Reads a directory of per-task JSON records (written by benchmark/run.ts with
// `--arm ... --out=<dir>`) plus an optional manifest.json, and computes the
// ADR-0001-mandated conclusion shape:
//
//   - success rate delta (+X pp): plugin success rate minus plain success rate
//   - repair rounds to success/failure per arm
//   - plugin overhead: +Y tokens/task and total wall-time delta
//   - tool call-rate on eligible turns + revisit-trigger evaluation
//
// Skipped records (e.g. go tasks without a toolchain) are excluded from the
// success-rate / overhead math but reported under `skipped` so the manifest is
// honest. This module is pure and offline — it never touches the network or
// the dsh CLI; it is unit-tested against fixture records in
// test/benchmark-aggregate.test.ts.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Arm, TaskRecord } from './types.ts';

/**
 * ADR-0001 §Model guidance revisit trigger: if the plugin arm's self_debug
 * call-rate is materially below 100% of "about to claim done" moments, a
 * plugin-registered system-prompt section is added as an ADR amendment. We
 * treat any rate strictly below 100% as triggering; the constant names the
 * policy so it can be revisited (e.g. allow a small tolerance) without hunting
 * through the math.
 */
export const CALL_RATE_REVISIT_THRESHOLD = 1.0;

export interface ArmStat {
  pass: number;
  fail: number;
  total: number;
  /** Pass rate as a percentage (0–100). */
  successRatePp: number;
  /** roundsUsed for passing runs (repair rounds to success). */
  roundsToSuccess: number[];
  /** roundsUsed for failing runs (repair rounds to failure). */
  roundsToFailure: number[];
  avgRoundsToSuccess: number | null;
  avgRoundsToFailure: number | null;
}

export interface CallRateStat {
  eligibleTurns: number;
  selfDebugCalls: number;
  /** calls / eligible turns, or null when no eligible turn occurred. */
  rate: number | null;
  /** True when the revisit trigger fires (rate materially below 100%). */
  revisitTrigger: boolean;
  note: string;
}

export interface SkippedStat {
  taskId: string;
  arm: Arm;
  reason: string;
}

export interface BenchmarkConclusion {
  /** Number of tasks with at least one executed (non-skipped) arm record. */
  n: number;
  plugin: ArmStat;
  plain: ArmStat;
  /** plugin success rate minus plain success rate, in percentage points. */
  successRateDeltaPp: number | null;
  overhead: {
    /** plugin avg total tokens/task minus plain avg total tokens/task. */
    tokensPerTask: number | null;
    /** plugin avg wall time minus plain avg wall time, in ms. */
    wallTimeDeltaMs: number | null;
  };
  callRate: CallRateStat;
  skipped: SkippedStat[];
  /** ISO timestamp the aggregation ran. */
  generatedAt: string;
  /** Records directory the conclusion was derived from. */
  source: string;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function emptyArmStat(): ArmStat {
  return {
    pass: 0,
    fail: 0,
    total: 0,
    successRatePp: 0,
    roundsToSuccess: [],
    roundsToFailure: [],
    avgRoundsToSuccess: null,
    avgRoundsToFailure: null,
  };
}

function armStat(records: TaskRecord[]): ArmStat {
  const stat = emptyArmStat();
  stat.total = records.length;
  stat.pass = records.filter((r) => r.verdict === 'pass').length;
  stat.fail = stat.total - stat.pass;
  stat.successRatePp = stat.total > 0 ? (stat.pass / stat.total) * 100 : 0;
  stat.roundsToSuccess = records.filter((r) => r.verdict === 'pass').map((r) => r.roundsUsed);
  stat.roundsToFailure = records.filter((r) => r.verdict === 'fail').map((r) => r.roundsUsed);
  stat.avgRoundsToSuccess = mean(stat.roundsToSuccess);
  stat.avgRoundsToFailure = mean(stat.roundsToFailure);
  return stat;
}

/** Average total (input+output) tokens per task for an arm, or null if none reported. */
function avgTotalTokens(records: TaskRecord[]): number | null {
  const totals = records
    .filter((r) => r.tokens.source === 'dsh')
    .map((r) => (r.tokens.input ?? 0) + (r.tokens.output ?? 0));
  return mean(totals);
}

function avgWallTime(records: TaskRecord[]): number | null {
  return mean(records.map((r) => r.wallTimeMs));
}

function isTaskRecord(value: unknown): value is TaskRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.taskId === 'string' && (v.arm === 'plugin' || v.arm === 'plain') && 'verdict' in v;
}

/** Load every TaskRecord JSON in `dir` (ignores manifest.json and non-records). */
export function loadRecords(dir: string): TaskRecord[] {
  if (!existsSync(dir)) return [];
  const out: TaskRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || name === 'manifest.json') continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (isTaskRecord(parsed)) out.push(parsed);
    } catch {
      // Not a record (e.g. manifest already filtered; ignore parse errors).
    }
  }
  return out;
}

/**
 * Compute the ADR-mandated conclusion from a records directory. Pure and
 * offline; the directory must have been produced by a real (or scripted) run
 * of benchmark/run.ts.
 */
export function aggregate(recordsDir: string): BenchmarkConclusion {
  const records = loadRecords(recordsDir);
  const plugin = armStat(records.filter((r) => r.arm === 'plugin' && r.status === 'run'));
  const plain = armStat(records.filter((r) => r.arm === 'plain' && r.status === 'run'));

  const successRateDeltaPp =
    plugin.total > 0 && plain.total > 0 ? plugin.successRatePp - plain.successRatePp : null;

  const pluginTokens = avgTotalTokens(records.filter((r) => r.arm === 'plugin' && r.status === 'run'));
  const plainTokens = avgTotalTokens(records.filter((r) => r.arm === 'plain' && r.status === 'run'));
  const tokensPerTask =
    pluginTokens !== null && plainTokens !== null ? pluginTokens - plainTokens : null;

  const pluginWall = avgWallTime(records.filter((r) => r.arm === 'plugin' && r.status === 'run'));
  const plainWall = avgWallTime(records.filter((r) => r.arm === 'plain' && r.status === 'run'));
  const wallTimeDeltaMs = pluginWall !== null && plainWall !== null ? pluginWall - plainWall : null;

  const pluginRun = records.filter((r) => r.arm === 'plugin' && r.status === 'run');
  const eligibleTurns = pluginRun.reduce((a, r) => a + r.eligibleTurns, 0);
  const selfDebugCalls = pluginRun.reduce((a, r) => a + r.selfDebugCalls, 0);
  const rate = eligibleTurns > 0 ? selfDebugCalls / eligibleTurns : null;
  const revisitTrigger = eligibleTurns > 0 && rate !== null && rate < CALL_RATE_REVISIT_THRESHOLD;
  const callRate: CallRateStat = {
    eligibleTurns,
    selfDebugCalls,
    rate,
    revisitTrigger,
    note:
      eligibleTurns === 0
        ? 'No eligible "about to claim done" turns were observed (no plugin-arm runs or no self_debug-capable transcript).'
        : revisitTrigger
          ? `Call-rate ${(rate! * 100).toFixed(1)}% is below 100% of eligible turns; ADR revisit trigger fires — consider a plugin-registered system-prompt section.`
          : `Call-rate ${(rate! * 100).toFixed(1)}% of eligible turns; revisit trigger not fired.`,
  };

  const skipped: SkippedStat[] = records
    .filter((r) => r.status === 'skipped')
    .map((r) => ({ taskId: r.taskId, arm: r.arm, reason: r.skipReason ?? 'skipped' }));

  const ranTaskIds = new Set(
    records.filter((r) => r.status === 'run').map((r) => r.taskId),
  );

  return {
    n: ranTaskIds.size,
    plugin,
    plain,
    successRateDeltaPp,
    overhead: { tokensPerTask, wallTimeDeltaMs },
    callRate,
    skipped,
    generatedAt: new Date().toISOString(),
    source: recordsDir,
  };
}

// Optional CLI: `node --experimental-strip-types benchmark/aggregate.ts --dir <dir>`
const isMain = process.argv[1] && /aggregate\.ts$/.test(process.argv[1]);
if (isMain) {
  const arg = process.argv.find((a) => a.startsWith('--dir='));
  const dir = arg ? arg.slice('--dir='.length) : '.bench/records';
  if (!existsSync(dir)) {
    console.error(`records directory not found: ${dir} (run the benchmark with --out=${dir} first)`);
    process.exit(2);
  }
  console.log(JSON.stringify(aggregate(dir), null, 2));
}

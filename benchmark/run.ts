// Benchmark harness CLI (T8/T9).
//
// Offline by default. The scripted driver demonstrates the harness with NO LLM
// and NO network; the dry-run self-check (`--dry-run` or no args) verifies the
// independent verdict path. Real dual-arm runs with the dsh model driver (T9)
// need DEEPSEEK_API_KEY and `npx @deepseek-ai/dsh`; they are selected with
// `--arm` and write per-task JSON records plus a run manifest to `--out`.
//
// Usage:
//   node --experimental-strip-types benchmark/run.ts                  # dry-run self-check
//   node --experimental-strip-types benchmark/run.ts --dry-run        # explicit dry-run
//   node --experimental-strip-types benchmark/run.ts --list           # list committed tasks
//   node --experimental-strip-types benchmark/run.ts --task=<id>      # scripted dual-arm demo (offline)
//   node --experimental-strip-types benchmark/run.ts \
//       --arm=both --task=all --out=.bench/records                   # REAL run (needs DEEPSEEK_API_KEY)
//
// The scripted driver's "solve" behaviour stands in for a model: it applies the
// task's canonical `solution`, so a task that is offline-runnable and correctly
// specified shows plugin=pass and plain=pass.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Ensure the bundled Node toolchain is on PATH so acceptance subprocesses
// (`node --test`) resolve even when the script is launched from a bare shell.
const DEFAULT_NODE_BIN = '/Users/Admin/.workbuddy/binaries/node/versions/22.22.2-2/bin';
const nodeBin = process.env.DSH_NODE_BIN_DIR ?? DEFAULT_NODE_BIN;
if (existsSync(join(nodeBin, 'node'))) {
  const sep = process.platform === 'win32' ? ';' : ':';
  process.env.PATH = `${nodeBin}${sep}${process.env.PATH ?? ''}`;
}

import { TASKS } from './tasks/index.ts';
import { verifyDryRun } from './dryrun.ts';
import { runTask, runDualArm } from './harness.ts';
import { ScriptedDriver } from './drivers/scripted.ts';
import { DshDriver } from './drivers/dsh.ts';
import type { Arm, BenchmarkTask, TaskRecord } from './types.ts';

interface CliArgs {
  dryRun: boolean;
  list: boolean;
  task?: string;
  arm?: 'plugin' | 'plain' | 'both';
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = { dryRun: false, list: false };
  for (const a of args) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--list') out.list = true;
    else if (a.startsWith('--task=')) out.task = a.slice('--task='.length);
    else if (a.startsWith('--arm=')) {
      const v = a.slice('--arm='.length);
      if (v === 'plugin' || v === 'plain' || v === 'both') out.arm = v;
      else throw new Error(`--arm must be one of plugin|plain|both (got "${v}")`);
    } else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else throw new Error(`unknown argument "${a}"`);
  }
  return out;
}

/** Default model label for the run manifest (override with DSH_MODEL). */
const MANIFEST_MODEL = process.env.DSH_MODEL ?? 'deepseek-chat';

interface RunManifest {
  model: string;
  date: string;
  /** Number of tasks with at least one executed (non-skipped) arm record. */
  n: number;
  /** Git SHA the benchmark ran against (honest provenance). */
  gitSha: string;
  /** True when DEEPSEEK_API_KEY was present at run time — NEVER the value. */
  keyPresent: boolean;
  arms: Arm[];
}

function gitSha(): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function resolveTasks(task: string | undefined): BenchmarkTask[] {
  if (!task || task === 'all') return TASKS;
  const t = TASKS.find((x) => x.id === task);
  if (!t) throw new Error(`unknown task "${task}" (use --list to see available tasks)`);
  return [t];
}

async function runReal(args: CliArgs): Promise<void> {
  const tasks = resolveTasks(args.task);
  const out = args.out ?? '.bench/records';
  mkdirSync(out, { recursive: true });

  const arms: Arm[] = args.arm === 'both' || !args.arm ? ['plugin', 'plain'] : [args.arm];
  const manifest: RunManifest = {
    model: MANIFEST_MODEL,
    date: new Date().toISOString().slice(0, 10),
    n: 0,
    gitSha: gitSha(),
    keyPresent: !!process.env.DEEPSEEK_API_KEY,
    arms,
  };

  const ranTaskIds = new Set<string>();
  for (const t of tasks) {
    const recs: (TaskRecord | null)[] = [];
    if (arms.includes('plugin')) recs.push(await runTask(t, new DshDriver('plugin')));
    if (arms.includes('plain')) recs.push(await runTask(t, new DshDriver('plain')));
    for (const rec of recs) {
      if (!rec) continue;
      const suffix = rec.status === 'skipped' ? 'skipped' : rec.arm;
      writeJson(join(out, `${t.id}-${suffix}.json`), rec);
      if (rec.status === 'run') ranTaskIds.add(t.id);
      console.log(
        `task ${t.id} [${rec.arm}]: status=${rec.status} ` +
          (rec.status === 'skipped' ? `skip="${rec.skipReason}"` : `verdict=${rec.verdict} rounds=${rec.roundsUsed}`),
      );
    }
  }

  manifest.n = ranTaskIds.size;
  writeJson(join(out, 'manifest.json'), manifest);
  console.log(`\nwrote ${ranTaskIds.size} executed task(s) to ${out} (manifest: model=${manifest.model}, keyPresent=${manifest.keyPresent}, sha=${manifest.gitSha})`);
}

async function main(): Promise<void> {
  const { dryRun, list, task, arm } = parseArgs(process.argv);

  if (list) {
    for (const t of TASKS) {
      console.log(`${t.id}\t${t.language}\t${t.offlineRunnable ? 'offline' : 'T9'}\t${t.title}`);
    }
    return;
  }

  // Real run selected by --arm (requires DEEPSEEK_API_KEY at run time).
  if (arm) {
    await runReal(parseArgs(process.argv));
    return;
  }

  // Default (and --dry-run): offline self-check, no model, no network.
  if (dryRun || !task) {
    const r = await verifyDryRun();
    console.log(
      `dry-run: known-pass judged ${r.passJudged ? 'PASS' : 'FAIL'}, ` +
        `known-fail judged ${r.failJudged ? 'FAIL' : 'PASS'}`,
    );
    if (!r.ok) {
      console.error('dry-run self-check FAILED');
      process.exit(1);
    }
    console.log('dry-run self-check GREEN');
    return;
  }

  // Scripted dual-arm demo on one task (offline, deterministic).
  const t = TASKS.find((x) => x.id === task);
  if (!t) {
    console.error(`unknown task "${task}" (use --list to see available tasks)`);
    process.exit(2);
  }
  const { plugin, plain } = await runDualArm(
    t,
    new ScriptedDriver({ arm: 'plugin', behavior: 'solve', callTool: true }),
    new ScriptedDriver({ arm: 'plain', behavior: 'solve' }),
  );
  console.log(`task ${t.id}:`);
  console.log(
    `  plugin  arm: verdict=${plugin.verdict} rounds=${plugin.roundsUsed} ` +
      `eligibleTurns=${plugin.eligibleTurns} selfDebugCalls=${plugin.selfDebugCalls} ` +
      `callRate=${plugin.callRate}`,
  );
  console.log(
    `  plain   arm: verdict=${plain.verdict} rounds=${plain.roundsUsed} ` +
      `eligibleTurns=${plain.eligibleTurns} selfDebugCalls=${plain.selfDebugCalls}`,
  );
  if (plugin.verdict !== 'pass' || plain.verdict !== 'pass') process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

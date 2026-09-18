// Benchmark harness CLI (T8, issue #9).
//
// Offline by default. Real dual-arm runs with the dsh model driver are T9's
// job (they need DEEPSEEK_API_KEY and `npx @deepseek-ai/dsh`); this CLI wires
// the scripted driver so the harness can be demonstrated and the dry-run
// self-check can be run from the command line.
//
// Usage:
//   node --experimental-strip-types benchmark/run.ts            # dry-run self-check
//   node --experimental-strip-types benchmark/run.ts --dry-run  # same, explicit
//   node --experimental-strip-types benchmark/run.ts --list     # list committed tasks
//   node --experimental-strip-types benchmark/run.ts --task=<id>  # dual-arm demo on one task
//
// The scripted driver's "solve" behaviour stands in for a model: it applies the
// task's canonical `solution`, so a task that is offline-runnable and correctly
// specified will show plugin=pass and plain=pass.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
import { runDualArm } from './harness.ts';
import { ScriptedDriver } from './drivers/scripted.ts';

interface CliArgs {
  dryRun: boolean;
  list: boolean;
  task?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = { dryRun: false, list: false };
  for (const a of args) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--list') out.list = true;
    else if (a.startsWith('--task=')) out.task = a.slice('--task='.length);
  }
  return out;
}

async function main(): Promise<void> {
  const { dryRun, list, task } = parseArgs(process.argv);

  if (list) {
    for (const t of TASKS) {
      console.log(`${t.id}\t${t.language}\t${t.offlineRunnable ? 'offline' : 'T9'}\t${t.title}`);
    }
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

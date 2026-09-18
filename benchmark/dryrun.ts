// Dry-run self-check (T8, issue #9).
//
// The harness must be able to judge known-good and known-bad tasks correctly
// with NO LLM and NO network — this is what proves the independent verdict
// path does not depend on a model or the plugin. Two tiny node workspaces are
// judged with a no-op ("idle") driver so the verdict is decided purely by the
// harness re-running the acceptance command itself: one already passes, one
// already fails.
//
// This runs under vitest (`npm test`) so it is part of the standing suite.

import type { BenchmarkTask } from './types.ts';
import { runTask } from './harness.ts';
import { ScriptedDriver } from './drivers/scripted.ts';

const DRYRUN_PKG = JSON.stringify(
  { name: 'dryrun', version: '0.1.0', private: true, type: 'commonjs', scripts: { test: 'node --test' } },
  null,
  2,
);

/** A workspace whose acceptance test passes from the start. */
export const knownPass: BenchmarkTask = {
  id: 'dryrun-known-pass',
  title: 'Dry-run known-pass',
  language: 'node',
  prompt: 'noop',
  scaffold: {
    'package.json': DRYRUN_PKG,
    'index.js': 'module.exports.add = (a, b) => a + b;\n',
    'index.test.js':
      "const t = require('node:test');\nconst a = require('node:assert');\nconst { add } = require('./index.js');\nt('add', () => a.strictEqual(add(2, 2), 4));\n",
  },
  acceptanceFiles: ['index.test.js'],
  acceptanceCommand: 'node --test',
  expectedPass: 'add(2, 2) === 4',
  solution: { 'index.js': 'module.exports.add = (a, b) => a + b;\n' },
  offlineRunnable: true,
};

/** A workspace whose acceptance test fails from the start (asserts 5). */
export const knownFail: BenchmarkTask = {
  id: 'dryrun-known-fail',
  title: 'Dry-run known-fail',
  language: 'node',
  prompt: 'noop',
  scaffold: {
    'package.json': DRYRUN_PKG,
    'index.js': 'module.exports.add = (a, b) => a + b;\n',
    'index.test.js':
      "const t = require('node:test');\nconst a = require('node:assert');\nconst { add } = require('./index.js');\nt('add', () => a.strictEqual(add(2, 2), 5));\n",
  },
  acceptanceFiles: ['index.test.js'],
  acceptanceCommand: 'node --test',
  expectedPass: 'add(2, 2) === 4 (this task asserts 5, so it must be judged FAIL)',
  solution: { 'index.js': 'module.exports.add = (a, b) => a + b;\n' },
  offlineRunnable: true,
};

export interface DryRunResult {
  passJudged: boolean;
  failJudged: boolean;
  ok: boolean;
}

/**
 * Self-verify the harness: the known-pass task must be judged PASS and the
 * known-fail task FAIL, using only the harness's own acceptance re-run (no
 * agent intelligence). Returns the per-judgment results plus an overall flag.
 */
export async function verifyDryRun(): Promise<DryRunResult> {
  const idle = new ScriptedDriver({ arm: 'plain', behavior: 'idle' });
  const rPass = await runTask(knownPass, idle);
  const rFail = await runTask(knownFail, idle);
  const passJudged = rPass.verdict === 'pass';
  const failJudged = rFail.verdict === 'fail';
  return { passJudged, failJudged, ok: passJudged && failJudged };
}

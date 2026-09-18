import { describe, it, expect } from 'vitest';
import { runTask, runDualArm, MAX_ROUNDS } from '../benchmark/harness.ts';
import { ScriptedDriver } from '../benchmark/drivers/scripted.ts';
import { TASKS } from '../benchmark/tasks/index.ts';

// The dual-arm E2E and hash-guard tests run against offline-runnable tasks.
// Go tasks are excluded here (they execute at T9 where the go toolchain exists);
// the verdict logic is language-agnostic and proven via node/python tasks.
const offline = TASKS.filter((t) => t.offlineRunnable === true);
const e2eTask = offline.find((t) => t.language === 'node');
if (!e2eTask) throw new Error('no offline node task available for E2E');

describe('T8 dual-arm end-to-end (criterion 2)', () => {
  it('runs plugin and plain arms end-to-end on a real node task', async () => {
    const { plugin, plain } = await runDualArm(
      e2eTask,
      new ScriptedDriver({ arm: 'plugin', behavior: 'solve', callTool: true }),
      new ScriptedDriver({ arm: 'plain', behavior: 'solve' }),
    );

    // Both arms repair the task to a passing state independently.
    expect(plugin.verdict).toBe('pass');
    expect(plain.verdict).toBe('pass');

    // Equal repair budget in BOTH arms (fairness rule).
    expect(plugin.maxRounds).toBe(MAX_ROUNDS);
    expect(plain.maxRounds).toBe(MAX_ROUNDS);
    expect(plugin.roundsUsed).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(plain.roundsUsed).toBeLessThanOrEqual(MAX_ROUNDS);

    // Plugin arm recorded the self_debug call on its eligible turn.
    expect(plugin.eligibleTurns).toBeGreaterThanOrEqual(1);
    expect(plugin.selfDebugCalls).toBeGreaterThanOrEqual(1);
    expect(plugin.callRate).toBeGreaterThan(0);

    // Plain arm had an eligible turn but no tool to call.
    expect(plain.eligibleTurns).toBeGreaterThanOrEqual(1);
    expect(plain.selfDebugCalls).toBe(0);
  });
});

describe('T8 hash guard (criterion 3)', () => {
  it('fails automatically when the acceptance test file is modified', async () => {
    const rec = await runTask(e2eTask, new ScriptedDriver({ arm: 'plugin', behavior: 'cheat' }));
    expect(rec.hashModified).toBe(true);
    expect(rec.modifiedFiles.length).toBeGreaterThan(0);
    expect(rec.verdict).toBe('fail');
    expect(rec.verdictReason).toBe('hash_modified');
    expect(rec.acceptanceExitCode).toBeNull();
  });

  it('does not trip when the agent edits only non-acceptance files', async () => {
    const rec = await runTask(e2eTask, new ScriptedDriver({ arm: 'plugin', behavior: 'solve' }));
    expect(rec.hashModified).toBe(false);
    expect(rec.modifiedFiles).toEqual([]);
  });
});

describe('T8 per-task records (criterion 4)', () => {
  it('captures rounds, tool calls, tokens, and wall time', async () => {
    const rec = await runTask(
      e2eTask,
      new ScriptedDriver({ arm: 'plugin', behavior: 'solve', callTool: true }),
    );
    expect(typeof rec.roundsUsed).toBe('number');
    expect(rec.roundsUsed).toBeGreaterThanOrEqual(1);
    expect(typeof rec.eligibleTurns).toBe('number');
    expect(typeof rec.selfDebugCalls).toBe('number');
    expect(rec.tokens).toHaveProperty('input');
    expect(rec.tokens).toHaveProperty('output');
    expect(rec.tokens).toHaveProperty('source');
    expect(typeof rec.wallTimeMs).toBe('number');
    expect(rec.wallTimeMs).toBeGreaterThanOrEqual(0);
  });
});

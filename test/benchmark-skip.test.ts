import { describe, it, expect } from 'vitest';
import { runTask, detectSkip, commandExists, skipRecord } from '../benchmark/harness.ts';
import { DshDriver } from '../benchmark/drivers/dsh.ts';
import { TASKS } from '../benchmark/tasks/index.ts';
import type { BenchmarkTask } from '../benchmark/types.ts';

const goTask = TASKS.find((t) => t.language === 'go');
const nodeTask = TASKS.find((t) => t.language === 'node');

describe('T9 go-toolchain skip mechanism', () => {
  it('commandExists resolves binaries on PATH and rejects missing ones', () => {
    expect(commandExists('node')).toBe(true);
    expect(commandExists('definitely-not-a-real-binary-xyz')).toBe(false);
  });

  it('detectSkip flags go tasks (offlineRunnable false) with a reason', () => {
    if (!goTask) throw new Error('expected a go task in the committed list');
    const r = detectSkip(goTask);
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/go task|toolchain/i);
  });

  it('detectSkip does not flag offline node tasks', () => {
    if (!nodeTask) throw new Error('expected a node task');
    expect(detectSkip(nodeTask).skip).toBe(false);
  });

  it('runTask returns a skipped record (status=skipped) for a go task', async () => {
    if (!goTask) throw new Error('expected a go task');
    const rec = await runTask(goTask, new DshDriver('plugin'));
    expect(rec.status).toBe('skipped');
    expect(rec.skipReason).toBeTruthy();
    expect(rec.verdict).toBe('fail');
    expect(rec.wallTimeMs).toBe(0);
  });

  it('skipRecord shapes a valid skipped TaskRecord', () => {
    const t: BenchmarkTask = { ...(nodeTask as BenchmarkTask), offlineRunnable: false };
    const r = skipRecord(t, 'skip reason');
    expect(r.status).toBe('skipped');
    expect(r.skipReason).toBe('skip reason');
    expect(r.tokens.source).toBe('none');
  });
});

describe('T9 DshDriver offline safety gates', () => {
  it('throws an actionable error when DEEPSEEK_API_KEY is unset', async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const driver = new DshDriver('plugin');
      await expect(driver.runRound({ arm: 'plugin' } as never)).rejects.toThrow(/DEEPSEEK_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    }
  });
});

import { describe, it, expect } from 'vitest';
import { TASKS } from '../benchmark/tasks/index.ts';
import { runTask } from '../benchmark/harness.ts';
import { ScriptedDriver } from '../benchmark/drivers/scripted.ts';
import type { BenchmarkTask } from '../benchmark/types.ts';

// Criterion 5: the committed task list has 15-20 tasks of uniform shape, each
// with a per-task acceptance command, and the offline ones actually pass when
// their (correct) solution is applied — a sanity check on the committed artifacts.
describe('T8 committed task list (criterion 5)', () => {
  it('contains 15-20 tasks', () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(15);
    expect(TASKS.length).toBeLessThanOrEqual(20);
  });

  it('every task has the uniform shape with a per-task acceptance command', () => {
    const ids = new Set<string>();
    for (const t of TASKS as BenchmarkTask[]) {
      expect(t.id).toBeTruthy();
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(['node', 'python', 'go']).toContain(t.language);
      expect(typeof t.prompt).toBe('string');
      expect(t.prompt.length).toBeGreaterThan(0);
      expect(typeof t.acceptanceCommand).toBe('string');
      expect(t.acceptanceCommand.length).toBeGreaterThan(0);
      expect(Array.isArray(t.acceptanceFiles)).toBe(true);
      expect(t.acceptanceFiles.length).toBeGreaterThan(0);
      expect(typeof t.scaffold).toBe('object');
      expect(typeof t.solution).toBe('object');
      expect(typeof t.expectedPass).toBe('string');
    }
  });

  it('go tasks are deferred to T9; node/python tasks are offline-runnable', () => {
    for (const t of TASKS) {
      if (t.language === 'go') {
        expect(t.offlineRunnable).not.toBe(true);
      } else {
        expect(t.offlineRunnable).toBe(true);
      }
    }
  });

  it('every offline task passes when its canonical solution is applied', async () => {
    const driver = new ScriptedDriver({ arm: 'plugin', behavior: 'solve', callTool: false });
    for (const t of TASKS.filter((x) => x.offlineRunnable === true)) {
      const rec = await runTask(t, driver);
      expect(rec.verdict, `task "${t.id}" should pass with its solution applied`).toBe('pass');
      expect(rec.verdictReason).toBe('acceptance');
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, loadRecords, CALL_RATE_REVISIT_THRESHOLD } from '../benchmark/aggregate.ts';
import type { Arm, TaskRecord } from '../benchmark/types.ts';

// Build a minimal-but-complete TaskRecord for fixture aggregation.
function rec(over: Partial<TaskRecord> & { taskId: string; arm: Arm }): TaskRecord {
  return {
    taskId: over.taskId,
    arm: over.arm,
    driver: over.driver ?? 'dsh',
    status: over.status ?? 'run',
    skipReason: over.skipReason,
    roundsUsed: over.roundsUsed ?? 1,
    maxRounds: over.maxRounds ?? 3,
    claimedDone: over.claimedDone ?? true,
    eligibleTurns: over.eligibleTurns ?? 0,
    selfDebugCalls: over.selfDebugCalls ?? 0,
    callRate: over.callRate ?? null,
    tokens: over.tokens ?? { input: null, output: null, source: 'none' },
    wallTimeMs: over.wallTimeMs ?? 0,
    hashModified: over.hashModified ?? false,
    modifiedFiles: over.modifiedFiles ?? [],
    verdict: over.verdict ?? 'pass',
    verdictReason: over.verdictReason ?? 'acceptance',
    acceptanceExitCode: over.acceptanceExitCode ?? 0,
  };
}

describe('T9 aggregator (fixture records)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-agg-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty stats for a directory with no records', () => {
    const c = aggregate(dir);
    expect(c.n).toBe(0);
    expect(c.successRateDeltaPp).toBeNull();
    expect(c.plugin.total).toBe(0);
    expect(c.plain.total).toBe(0);
    expect(c.callRate.rate).toBeNull();
    expect(c.skipped).toEqual([]);
  });

  it('computes success-rate delta, overhead, and call-rate from paired records', () => {
    // plugin: 2 pass, 1 fail  -> 66.67%; plain: 1 pass, 2 fail -> 33.33%
    // delta = +33.33 pp
    writeFileSync(
      join(dir, 't1-plugin.json'),
      JSON.stringify(
        rec({ taskId: 't1', arm: 'plugin', verdict: 'pass', eligibleTurns: 1, selfDebugCalls: 1, tokens: { input: 100, output: 50, source: 'dsh' }, wallTimeMs: 1000 }),
      ),
    );
    writeFileSync(
      join(dir, 't2-plugin.json'),
      JSON.stringify(
        rec({ taskId: 't2', arm: 'plugin', verdict: 'pass', eligibleTurns: 1, selfDebugCalls: 1, tokens: { input: 120, output: 60, source: 'dsh' }, wallTimeMs: 1100 }),
      ),
    );
    writeFileSync(
      join(dir, 't3-plugin.json'),
      JSON.stringify(
        rec({ taskId: 't3', arm: 'plugin', verdict: 'fail', eligibleTurns: 1, selfDebugCalls: 0, tokens: { input: 90, output: 40, source: 'dsh' }, wallTimeMs: 900 }),
      ),
    );
    writeFileSync(
      join(dir, 't1-plain.json'),
      JSON.stringify(rec({ taskId: 't1', arm: 'plain', verdict: 'pass', tokens: { input: 80, output: 30, source: 'dsh' }, wallTimeMs: 800 })),
    );
    writeFileSync(
      join(dir, 't2-plain.json'),
      JSON.stringify(rec({ taskId: 't2', arm: 'plain', verdict: 'fail', tokens: { input: 85, output: 35, source: 'dsh' }, wallTimeMs: 820 })),
    );
    writeFileSync(
      join(dir, 't3-plain.json'),
      JSON.stringify(rec({ taskId: 't3', arm: 'plain', verdict: 'fail', tokens: { input: 70, output: 25, source: 'dsh' }, wallTimeMs: 810 })),
    );

    const c = aggregate(dir);
    expect(c.n).toBe(3);
    expect(c.plugin.total).toBe(3);
    expect(c.plugin.pass).toBe(2);
    expect(c.plugin.successRatePp).toBeCloseTo(66.666, 2);
    expect(c.plain.successRatePp).toBeCloseTo(33.333, 2);
    expect(c.successRateDeltaPp).toBeCloseTo(33.333, 2);

    // overhead: plugin avg tokens = (150+180+130)/3 = 153.33; plain = (110+120+95)/3 = 108.33
    expect(c.overhead.tokensPerTask).toBeCloseTo(45, 0);
    // wall: plugin avg = 1000; plain avg = 810 -> delta +190
    expect(c.overhead.wallTimeDeltaMs).toBeCloseTo(190, 0);

    // call-rate over plugin arm: eligible 3, calls 2 -> 66.7% < threshold => trigger
    expect(c.callRate.eligibleTurns).toBe(3);
    expect(c.callRate.selfDebugCalls).toBe(2);
    expect(c.callRate.rate).toBeCloseTo(2 / 3, 3);
    expect(c.callRate.revisitTrigger).toBe(true);
    expect(CALL_RATE_REVISIT_THRESHOLD).toBe(1.0);
  });

  it('does not fire the revisit trigger at 100% call-rate', () => {
    writeFileSync(join(dir, 't1-plugin.json'), JSON.stringify(rec({ taskId: 't1', arm: 'plugin', eligibleTurns: 2, selfDebugCalls: 2 })));
    writeFileSync(join(dir, 't1-plain.json'), JSON.stringify(rec({ taskId: 't1', arm: 'plain' })));
    const c = aggregate(dir);
    expect(c.callRate.rate).toBe(1);
    expect(c.callRate.revisitTrigger).toBe(false);
  });

  it('excludes skipped records from n and arm stats but lists them', () => {
    writeFileSync(
      join(dir, 'go1-skipped.json'),
      JSON.stringify(
        rec({ taskId: 'go1', arm: 'plugin', status: 'skipped', skipReason: 'go toolchain absent', verdict: 'fail', eligibleTurns: 0, selfDebugCalls: 0 }),
      ),
    );
    writeFileSync(join(dir, 't1-plugin.json'), JSON.stringify(rec({ taskId: 't1', arm: 'plugin' })));
    writeFileSync(join(dir, 't1-plain.json'), JSON.stringify(rec({ taskId: 't1', arm: 'plain' })));

    const c = aggregate(dir);
    expect(c.n).toBe(1); // only t1 executed
    expect(c.plugin.total).toBe(1);
    expect(c.skipped).toHaveLength(1);
    expect(c.skipped[0]).toMatchObject({ taskId: 'go1', reason: 'go toolchain absent' });
  });

  it('loadRecords ignores manifest.json and non-record JSON', () => {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ model: 'x', n: 0, gitSha: 'abc', keyPresent: true, arms: ['plugin'] }));
    writeFileSync(join(dir, 'notes.json'), JSON.stringify({ random: true }));
    writeFileSync(join(dir, 't1-plugin.json'), JSON.stringify(rec({ taskId: 't1', arm: 'plugin' })));
    const recs = loadRecords(dir);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.taskId).toBe('t1');
  });
});

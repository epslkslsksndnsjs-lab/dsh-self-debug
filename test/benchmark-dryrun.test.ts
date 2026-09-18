import { describe, it, expect } from 'vitest';
import { verifyDryRun } from '../benchmark/dryrun.ts';

// Criterion 1: dry-run mode judges known-pass and known-fail mini tasks
// correctly with NO LLM and NO network. Runs under vitest.
describe('T8 dry-run self-check (criterion 1)', () => {
  it('judges known-pass as PASS and known-fail as FAIL, no agent involved', async () => {
    const r = await verifyDryRun();
    expect(r.passJudged).toBe(true);
    expect(r.failJudged).toBe(true);
    expect(r.ok).toBe(true);
  });
});

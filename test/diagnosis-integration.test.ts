import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selfDebug } from '../src/self-debug.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

function copyFixture(name: string): string {
  const dest = mkdtempSync(join(tmpdir(), `dsh-${name}-`));
  cpSync(join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

/** Parse the `full output: <path>` line written by the report. */
function logPathOf(report: string): string | undefined {
  const m = report.match(/^full output: (.+)$/m);
  return m?.[1];
}

describe('T2 failure path + diagnosis v0 (node fixtures)', () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  // Acceptance: a failing node fixture yields a Diagnosis block with the
  // correct class slug and hint.
  const slugCases: Array<[string, string]> = [
    ['node-failing', 'assertion_failure'],
    ['node-build-error', 'build_error'],
    ['node-environment-error', 'environment_error'],
    ['node-permission-error', 'permission_error'],
    ['node-timeout', 'timeout'],
    ['node-unknown', 'unknown'],
  ];
  for (const [fixture, slug] of slugCases) {
    it(`diagnoses ${fixture} as ${slug}`, async () => {
      tmp = copyFixture(fixture);
      const report = await selfDebug({ directory: tmp });

      expect(report).toContain('[FAIL]');
      expect(report).toContain(`Diagnosis: ${slug}`);
      // Hint body present and adjacent (right after the failing output).
      expect(report).toMatch(/Diagnosis: \w+\n {2}\S/);
      // The full output was persisted to disk and the path is in the report.
      const path = logPathOf(report);
      expect(path).toBeDefined();
      expect(existsSync(path!)).toBe(true);
    });
  }

  // Acceptance: over-budget failures shrink preview toward ~10 lines before
  // touching hints or duration; truncated output lands in a temp log.
  it('shrinks the preview but keeps hint+duration for an over-budget failure', async () => {
    tmp = copyFixture('node-large-output');
    const report = await selfDebug({ directory: tmp });

    const failIdx = report.indexOf('[FAIL]');
    const diagIdx = report.indexOf('Diagnosis:');
    const previewBlock = report.slice(failIdx, diagIdx);
    const previewLines = previewBlock.split('\n').filter((l) => l.startsWith('payload')).length;
    // Preview shrank toward ~10 (tail kept, head dropped).
    expect(previewLines).toBeLessThanOrEqual(11);
    expect(report).toContain('payload line 200');
    expect(report).not.toContain('payload line 001');
    // Hint + duration untouched (hard rule hint > duration > preview).
    expect(report).toMatch(/\[FAIL\] \d{4}ms \(exit 1\)/);
    expect(report).toContain('Diagnosis: unknown');

    // Full 200 lines live on disk, not in the preview.
    const path = logPathOf(report)!;
    const full = readFileSync(path, 'utf8');
    expect(full.split('\n').filter((l) => l.startsWith('payload')).length).toBe(200);
  });

  // Acceptance: a failing check is a normal result (no throw); only a bad
  // directory is the error-class response.
  it('treats a failing check as a normal result, not an exception', async () => {
    tmp = copyFixture('node-failing');
    await expect(selfDebug({ directory: tmp })).resolves.toContain('1 failed');
  });

  it('reserves the error-class response for an unidentifiable directory', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'dsh-bad-'));
    rmSync(bad, { recursive: true, force: true });
    const report = await selfDebug({ directory: bad });
    expect(report).toContain('cannot identify project type');
    expect(report).not.toContain('Diagnosis:');
  });

  // Acceptance: two consecutive runs produce identical report bytes.
  it('produces byte-identical reports across two runs of the same failure', async () => {
    tmp = copyFixture('node-failing');
    // Fixed clock: durations become constants, so "same inputs, same bytes"
    // holds exactly (the project's determinism contract, ADR-0001).
    const fixedNow = () => 1_000_000;
    const first = await selfDebug({ directory: tmp, now: fixedNow });
    const second = await selfDebug({ directory: tmp, now: fixedNow });
    expect(Buffer.from(first)).toEqual(Buffer.from(second));

    // Real-clock runs differ only in duration tokens.
    const a = await selfDebug({ directory: tmp });
    const b = await selfDebug({ directory: tmp });
    const stripDurations = (s: string): string => s.replace(/\d+ms/g, '');
    expect(stripDurations(a)).toBe(stripDurations(b));

    // The persisted full-log content is also identical across runs.
    const path = logPathOf(first)!;
    expect(readFileSync(path, 'utf8')).toBe(readFileSync(logPathOf(second)!, 'utf8'));
  });
});

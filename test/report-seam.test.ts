import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selfDebug } from '../src/self-debug.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

function copyFixture(name: string): string {
  const dest = mkdtempSync(join(tmpdir(), `dsh-${name}-`));
  cpSync(join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

describe('report seam (external behaviour: returned text only)', () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it('reports the honest cannot-identify response for an empty directory', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-empty-'));
    const report = await selfDebug({ directory: tmp });

    expect(report).toContain('cannot identify project type');
    // Lists every known marker so the model knows what to add.
    expect(report).toContain('package.json');
    expect(report).toContain('pyproject.toml');
    expect(report).toContain('go.mod');
    expect(report).toContain(tmp);
  });

  it('yields the all-pass report for a healthy node fixture (byte-stable across runs)', async () => {
    tmp = copyFixture('node-healthy');
    const first = await selfDebug({ directory: tmp });
    const second = await selfDebug({ directory: tmp });

    expect(first).toContain('project: node (package.json)');
    expect(first).toContain('all checks passed');
    // Pipeline order preserved.
    expect(first.indexOf('npm run --if-present lint')).toBeLessThan(
      first.indexOf('npm run --if-present test'),
    );
    expect(first.indexOf('npm run --if-present test')).toBeLessThan(
      first.indexOf('npm run --if-present build'),
    );
    // Per-command durations present.
    expect(first).toMatch(/\[PASS\] \d{4}ms/);

    // Determinism (issue acceptance): the report is identical across runs
    // except for the real wall-clock durations, which vary by run. We assert
    // (a) byte-length stability and (b) full byte identity once the variable
    // duration tokens are removed — proving no hidden state or ordering
    // nondeterminism in the rendering.
    expect(Buffer.byteLength(first)).toBe(Buffer.byteLength(second));
    const stripDurations = (s: string): string => s.replace(/\d+ms/g, '');
    expect(stripDurations(first)).toBe(stripDurations(second));
  });

  it('produces a byte-identical cannot-identify report across two runs of the same directory', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-empty-'));
    const first = await selfDebug({ directory: tmp });
    const second = await selfDebug({ directory: tmp });

    // Duration-free report: truly byte-identical for the same input.
    expect(first).toBe(second);
    expect(Buffer.from(first)).toEqual(Buffer.from(second));
  });

  it('stops at first failure and marks the rest skipped (report seam)', async () => {
    tmp = copyFixture('node-failing');
    const marker = join(tmp, 'build-ran.marker');
    const report = await selfDebug({ directory: tmp });

    expect(report).toContain('[FAIL]');
    expect(report).toContain('assertion failed: expected 2 but got 3');
    expect(report).toContain('[SKIP]');
    // The skipped command is the last pipeline step (build).
    expect(report).toContain('npm run --if-present build [SKIP]');
    // Stop-at-first-failure really skipped it: build never executed.
    expect(existsSync(marker)).toBe(false);
    // Only one failure recorded.
    expect(report).toContain('1 failed');
  });
});

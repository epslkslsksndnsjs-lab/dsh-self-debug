import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selfDebug } from '../src/self-debug.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const ORIGINAL_PATH = process.env.PATH;

function copyFixture(name: string): string {
  const dest = mkdtempSync(join(tmpdir(), `dsh-${name}-`));
  cpSync(join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

/**
 * Inject the fixture's fake `uv`/`go` toolchain onto PATH ahead of any real
 * one (issue #6 fixture strategy: PATH injection of stub binaries rather than a
 * real Python/Go toolchain). The stub scripts emit fixed, realistic-looking
 * failure output so diagnosis classifications can be exercised offline.
 */
function injectFakeTools(fixtureName: string): void {
  const binDir = join(FIXTURES, fixtureName, 'bin');
  if (existsSync(binDir)) {
    const sep = process.platform === 'win32' ? ';' : ':';
    process.env.PATH = `${binDir}${sep}${process.env.PATH ?? ''}`;
  }
}

describe('T5 python and go profiles end-to-end', () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
    // Restore PATH to the value captured after setup.ts (node bin on PATH).
    process.env.PATH = ORIGINAL_PATH;
  });

  it('runs the python pipeline and diagnoses the failing pytest (byte-stable)', async () => {
    tmp = copyFixture('python-failing');
    injectFakeTools('python-failing');
    const fixedNow = () => 1_000_000;
    const first = await selfDebug({ directory: tmp, now: fixedNow });
    const second = await selfDebug({ directory: tmp, now: fixedNow });

    // Marker + pipeline commands rendered verbatim (must match the ADR spec).
    expect(first).toContain('project: python (pyproject.toml)');
    expect(first).toContain('uv run pytest');
    expect(first).toContain('uv run ruff check . [SKIP]');
    // The failing command is diagnosed; the rest stops-at-first-failure skipped.
    expect(first).toContain('[FAIL]');
    expect(first).toContain('Diagnosis: assertion_failure');
    expect(first).toContain('1 failed');
    // Determinism (issue acceptance): same inputs, same bytes.
    expect(Buffer.from(first)).toEqual(Buffer.from(second));
  });

  it('runs the go pipeline and diagnoses the failing build', async () => {
    tmp = copyFixture('go-failing');
    injectFakeTools('go-failing');
    const fixedNow = () => 1_000_000;
    const report = await selfDebug({ directory: tmp, now: fixedNow });

    // Marker + pipeline commands rendered verbatim (must match the ADR spec).
    expect(report).toContain('project: go (go.mod)');
    expect(report).toContain('go build ./...');
    expect(report).toContain('go test ./... -count=1 [SKIP]');
    expect(report).toContain('go vet ./... [SKIP]');
    // `go build` error classifies as build_error per the decision tree.
    expect(report).toContain('Diagnosis: build_error');
    expect(report).toContain('1 failed');
  });

  it('mixed node+python: both profile sections run, each failure gets its own Diagnosis block', async () => {
    tmp = copyFixture('mixed-node-python');
    injectFakeTools('mixed-node-python');
    const fixedNow = () => 1_000_000;
    const report = await selfDebug({ directory: tmp, now: fixedNow });
    const second = await selfDebug({ directory: tmp, now: fixedNow });

    // Both profiles detected and listed in the header.
    expect(report).toContain('projects: node (package.json), python (pyproject.toml)');
    // Each profile gets its own section header.
    expect(report).toContain('== node (package.json) ==');
    expect(report).toContain('== python (pyproject.toml) ==');
    // node failure (its test step) and python failure (pytest) both surface.
    expect(report).toContain('npm run --if-present test [FAIL]');
    expect(report).toContain('uv run pytest [FAIL]');
    // Two independent Diagnosis blocks — one per profile's failing command.
    const diagCount = (report.match(/^Diagnosis: /gm) ?? []).length;
    expect(diagCount).toBe(2);
    expect(report).toContain('Diagnosis: assertion_failure');
    // Total across both profiles; neither failure leaks into the other.
    expect(report).toContain('2 failed');
    // Determinism (issue acceptance): same inputs, same bytes.
    expect(Buffer.from(report)).toEqual(Buffer.from(second));
  });

  it('unrecognized project still returns the honest cannot-identify response', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-empty-'));
    const report = await selfDebug({ directory: tmp });

    expect(report).toContain('cannot identify project type');
    expect(report).toContain('package.json');
    expect(report).toContain('pyproject.toml');
    expect(report).toContain('go.mod');
    expect(report).not.toContain('Diagnosis:');
  });
});

import { describe, expect, it } from 'vitest';
import { renderReport, type ReportOptions } from '../src/reporter.ts';
import type { CommandResult } from '../src/runner.ts';
import { diagnose } from '../src/diagnosis.ts';

// Pure report-render seam: we feed constructed CommandResults (no subprocess)
// and assert the Diagnosis block, tail preview, and truncation-priority rule.

function failResult(over: Partial<CommandResult>): CommandResult {
  const base: CommandResult = {
    index: 0,
    label: 'npm run --if-present test',
    run: 'npm run --if-present test',
    status: 'fail',
    exitCode: 1,
    output: 'assertion failed: expected 2 but got 3',
    durationMs: 42,
    diagnosis: diagnose('assertion failed: expected 2 but got 3'),
  };
  return { ...base, ...over };
}

const opts = (results: CommandResult[]): ReportOptions => ({
  profile: {
    id: 'node',
    marker: 'package.json',
    label: 'node',
    pipeline: [],
  },
  results,
  directory: '/tmp/dsh-probe',
});

describe('report Diagnosis block (pure render)', () => {
  it('renders an adjacent Diagnosis block with slug and hint for a failure', () => {
    const report = renderReport(opts([failResult({})]));

    expect(report).toContain('[FAIL]');
    expect(report).toContain('Diagnosis: assertion_failure');
    // Hint body is present.
    expect(report).toContain('A test assertion failed');
    // Diagnosis sits adjacent to the failure output (preview comes first).
    const failIdx = report.indexOf('[FAIL]');
    const diagIdx = report.indexOf('Diagnosis: assertion_failure');
    const previewIdx = report.indexOf('assertion failed: expected 2 but got 3');
    expect(previewIdx).toBeGreaterThan(failIdx);
    expect(diagIdx).toBeGreaterThan(previewIdx);
  });

  it('keeps the tail of large output and shows the temp-log path', () => {
    const big = Array.from({ length: 120 }, (_, i) => `payload line ${String(i + 1).padStart(3, '0')}`).join('\n');
    const report = renderReport(
      opts([failResult({ output: big, diagnosis: diagnose(big), logPath: '/tmp/dsh-log-abc-0.log' })]),
    );

    // Tail kept (last line present), head dropped (first line absent): tail truncation.
    expect(report).toContain('payload line 120');
    expect(report).not.toContain('payload line 001');
    // Full log path surfaces in the report.
    expect(report).toContain('full output: /tmp/dsh-log-abc-0.log');
  });

  it('honours the truncation priority: a narrowed preview still keeps hint + duration', () => {
    const big = Array.from({ length: 200 }, (_, i) => `payload line ${String(i + 1).padStart(3, '0')}`).join('\n');
    const report = renderReport(
      opts([failResult({ output: big, diagnosis: diagnose(big), logPath: '/tmp/dsh-log-abc-0.log' })]),
    );

    // Preview shrank toward ~10 lines (head dropped), but hint and duration lines
    // are untouched — the hard rule hint > duration > preview holds.
    expect(report).not.toContain('payload line 001');
    expect(report).toContain('Diagnosis: unknown');
    expect(report).toMatch(/\[FAIL\] \d{4}ms \(exit 1\)/);
    // The full 200 lines still live on disk, not in the preview.
    const previewTail = report.slice(report.indexOf('[FAIL]'), report.indexOf('Diagnosis:'));
    const previewLineCount = previewTail.split('\n').filter((l) => l.startsWith('payload')).length;
    expect(previewLineCount).toBeLessThanOrEqual(11);
  });
});

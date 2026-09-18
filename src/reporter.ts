import { Buffer } from 'node:buffer';
import { PROFILES, type Profile } from './profiles.ts';
import type { CommandResult } from './runner.ts';

// Pure-text, deterministic report rendering. No hidden state.
//
// Determinism: durations render at fixed width ("%04dms") and the caller injects
// a fixed clock, so the report is byte-identical across runs given the same
// inputs ("same inputs, same bytes").
//
// Truncation priority (ADR-0001 hard rule): hint > duration lines > preview.
// The Diagnosis hint and per-command duration are ALWAYS rendered; only the raw
// output preview length shrinks when the report is over budget. The preview is
// the last thing sacrificed because the full log is persisted to disk anyway.

/** Fixed-width duration token, e.g. 12 -> "0012ms". Keeps byte length stable. */
function fmtDuration(ms: number): string {
  return `${Math.max(0, Math.round(ms)).toString().padStart(4, '0')}ms`;
}

/** Hard 60-line / 4 KB report cap (ADR-0001 decision 5). */
const BUDGET_LINES = 60;
const BUDGET_BYTES = 4096;
/** Normal preview size; shrinks toward OVER_BUDGET_PREVIEW when over budget. */
const PREVIEW_MAX_LINES = 50;
const OVER_BUDGET_PREVIEW = 10;

export interface ReportOptions {
  profile: Profile;
  results: CommandResult[];
  /** Directory that was checked (for the header). */
  directory: string;
}

/** Render the tail `cap` lines of a command's output (tail truncation). */
function tailPreview(output: string, cap: number): string {
  return output
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .slice(-cap)
    .join('\n');
}

function renderResults(results: CommandResult[], previewCap: number): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === 'pass') {
      lines.push(`${r.index + 1}. ${r.label} [PASS] ${fmtDuration(r.durationMs)}`);
    } else if (r.status === 'fail') {
      lines.push(
        `${r.index + 1}. ${r.label} [FAIL] ${fmtDuration(r.durationMs)} (exit ${r.exitCode})`,
      );
      const preview = tailPreview(r.output, previewCap).trim();
      if (preview) {
        lines.push(preview);
      }
      // Diagnosis block renders immediately adjacent to the failure output it
      // explains — no separate top-level section (ADR-0001 §Report layout).
      lines.push(`Diagnosis: ${r.diagnosis?.klass ?? 'unknown'}`);
      for (const hintLine of (r.diagnosis?.hint ?? '').split('\n')) {
        lines.push(`  ${hintLine}`);
      }
      if (r.logPath) {
        lines.push(`full output: ${r.logPath}`);
      }
    } else {
      lines.push(
        `${r.index + 1}. ${r.label} [SKIP] (not run: stopped at first failure)`,
      );
    }
  }
  return lines.join('\n');
}

export function renderReport(options: ReportOptions): string {
  const { profile, results, directory } = options;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  const header = [
    'self_debug report',
    `project: ${profile.label} (${profile.marker})`,
    `directory: ${directory}`,
    `commands: ${passed} passed, ${failed} failed, ${skipped} skipped`,
    '--',
  ].join('\n');
  const summary = failed === 0 ? 'all checks passed' : `${failed} check${failed === 1 ? '' : 's'} failed`;

  const assemble = (previewCap: number): string =>
    `${header}\n${renderResults(results, previewCap)}\n--\n${summary}\n`;

  // The report has a hard cap; only the preview length is a budget variable,
  // so hints + durations are never touched (hard rule hint > duration > preview).
  // If the full report is over budget, shrink the preview toward OVER_BUDGET_PREVIEW.
  const overBudget = (s: string): boolean =>
    s.split('\n').length > BUDGET_LINES || Buffer.byteLength(s, 'utf8') > BUDGET_BYTES;

  let previewCap = PREVIEW_MAX_LINES;
  let report = assemble(previewCap);
  if (overBudget(report) && previewCap > OVER_BUDGET_PREVIEW) {
    previewCap = OVER_BUDGET_PREVIEW;
    report = assemble(previewCap);
  }

  return report;
}

/** Honest "cannot identify project type" response, listing every known marker. */
export function renderUnknown(directory: string): string {
  const lines: string[] = [];
  lines.push('self_debug report');
  lines.push('cannot identify project type');
  lines.push('checked markers:');
  for (const p of PROFILES) {
    lines.push(`  ${p.label}: ${p.marker}`);
  }
  lines.push(`no matching project found in: ${directory}`);
  return `${lines.join('\n')}\n`;
}

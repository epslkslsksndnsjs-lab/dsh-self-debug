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
/**
 * Preview cap in BYTES (not UTF-16 code units). Kept small because the full log
 * is on disk; shrinks further when the report is over budget.
 */
const PREVIEW_MAX_BYTES = 2048;
const OVER_BUDGET_PREVIEW_BYTES = 160;

export interface ReportOptions {
  profile: Profile;
  results: CommandResult[];
  /** Directory that was checked (for the header). */
  directory: string;
}

/**
 * Tail truncation in the byte domain: keep the last lines of `text` whose
 * combined UTF-8 byte length stays within `maxBytes`, dropping the oldest
 * (head). Line-aware so whole lines are kept, and byte-safe so a multi-byte
 * character is never cut in half. The tail (most recent output) is preserved.
 */
export function truncateTail(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const add = Buffer.byteLength(line, 'utf8') + (kept.length > 0 ? 1 : 0);
    if (kept.length > 0 && total + add > maxBytes) break;
    kept.unshift(line);
    total += add;
  }
  // A single line longer than the cap is trimmed from its head, byte-safe.
  if (kept.length === 1 && Buffer.byteLength(kept[0]!, 'utf8') > maxBytes) {
    const buf = Buffer.from(kept[0]!, 'utf8');
    let start = buf.length - maxBytes;
    while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
    kept[0] = buf.subarray(start).toString('utf8');
  }
  return kept.join('\n');
}

function renderResults(results: CommandResult[], previewCap: number): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === 'pass') {
      lines.push(`${r.index + 1}. ${r.label} [PASS] ${fmtDuration(r.durationMs)}`);
    } else if (r.status === 'fail') {
      const tail = r.timedOut ? ' (timeout)' : ` (exit ${r.exitCode})`;
      lines.push(
        `${r.index + 1}. ${r.label} [FAIL] ${fmtDuration(r.durationMs)}${tail}`,
      );
      const preview = truncateTail(r.output, previewCap).trim();
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
  // If the full report is over budget, shrink the preview toward
  // OVER_BUDGET_PREVIEW_BYTES.
  const overBudget = (s: string): boolean =>
    s.split('\n').length > BUDGET_LINES || Buffer.byteLength(s, 'utf8') > BUDGET_BYTES;

  let previewCap = PREVIEW_MAX_BYTES;
  let report = assemble(previewCap);
  if (overBudget(report) && PREVIEW_MAX_BYTES > OVER_BUDGET_PREVIEW_BYTES) {
    previewCap = OVER_BUDGET_PREVIEW_BYTES;
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

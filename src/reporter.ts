import { PROFILES, type Profile } from './profiles.ts';
import type { CommandResult } from './runner.ts';

// Pure-text, deterministic report rendering. No hidden state.
//
// Determinism note: durations are rendered at fixed width ("%04dms"), and the
// runner accepts an injectable clock — with a fixed clock the report is
// byte-identical across runs ("same inputs, same bytes"). Truncation priority
// (ADR-0001): hint > duration > preview.

/** Fixed-width duration token, e.g. 12 -> "0012ms". Keeps byte length stable. */
function fmtDuration(ms: number): string {
  return `${Math.max(0, Math.round(ms)).toString().padStart(4, '0')}ms`;
}

const PREVIEW_MAX_LINES = 50;

export interface ReportOptions {
  profile: Profile;
  results: CommandResult[];
  /** Directory that was checked (for the header). */
  directory: string;
}

export function renderReport(options: ReportOptions): string {
  const { profile, results, directory } = options;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  const lines: string[] = [];
  lines.push('self_debug report');
  lines.push(`project: ${profile.label} (${profile.marker})`);
  lines.push(`directory: ${directory}`);
  lines.push(`commands: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  lines.push('--');
  for (const r of results) {
    if (r.status === 'pass') {
      lines.push(`${r.index + 1}. ${r.label} [PASS] ${fmtDuration(r.durationMs)}`);
    } else if (r.status === 'fail') {
      lines.push(
        `${r.index + 1}. ${r.label} [FAIL] ${fmtDuration(r.durationMs)} (exit ${r.exitCode})`,
      );
      const preview = r.output
        .replace(/\r\n/g, '\n')
        .trim()
        .split('\n')
        .slice(0, PREVIEW_MAX_LINES)
        .join('\n');
      if (preview) {
        lines.push(preview);
      }
    } else {
      lines.push(
        `${r.index + 1}. ${r.label} [SKIP] (not run: stopped at first failure)`,
      );
    }
  }
  lines.push('--');
  lines.push(failed === 0 ? 'all checks passed' : `${failed} check${failed === 1 ? '' : 's'} failed`);
  return `${lines.join('\n')}\n`;
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

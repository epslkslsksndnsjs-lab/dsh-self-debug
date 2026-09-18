import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/runner.ts';
import { truncateTail, renderReport, type ReportOptions } from '../src/reporter.ts';
import { PROFILES } from '../src/profiles.ts';
import type { CommandResult } from '../src/runner.ts';

const NODE = process.execPath;

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-hardening-'));
}

/** Write a node script into `dir` and return the command line to run it. */
function script(dir: string, name: string, body: string): string {
  writeFileSync(join(dir, name), body);
  return `node ${name}`;
}

describe('T3 runner process hardening (real subprocess, no mocks)', () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
    delete process.env.GC_PID_FILE;
  });

  // --- Acceptance: timeout kills the whole process group; no orphan survives ---
  it('kills the process group on timeout so a grandchild cannot outlive it', async () => {
    tmp = makeTmp();
    // Grandchild: records its pid, then sleeps forever (would be an orphan).
    script(
      tmp,
      'grandchild.js',
      `const fs=require('fs'); fs.writeFileSync(process.env.GC_PID_FILE, String(process.pid)); setTimeout(()=>{}, 1e9);`,
    );
    // Runaway parent: spawns the grandchild (same process group) and sleeps forever.
    const run = script(
      tmp,
      'runaway.js',
      `const cp=require('child_process'); cp.spawn(${JSON.stringify(NODE)}, [${JSON.stringify(join(tmp, 'grandchild.js'))}], {stdio:'ignore'}); setTimeout(()=>{}, 1e9);`,
    );
    const gcPidFile = join(tmp, 'gc.pid');
    process.env.GC_PID_FILE = gcPidFile;

    const res = await runCommand({ run, label: 'runaway' }, 0, {
      cwd: tmp,
      timeoutMs: 800,
    });

    expect(res.status).toBe('fail');
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBeNull();
    // Resolved at (about) the timeout, not after the 1e9ms runaway finished.
    expect(res.durationMs).toBeGreaterThanOrEqual(600);
    expect(res.durationMs).toBeLessThan(4000);

    // The grandchild really started...
    expect(existsSync(gcPidFile)).toBe(true);
    const gcPid = Number(readFileSync(gcPidFile, 'utf8'));
    // ...and is now dead: the group kill left no orphan.
    await new Promise((r) => setTimeout(r, 300));
    let alive = true;
    try {
      process.kill(gcPid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });

  // --- Acceptance: a lingering pipe holder does not delay resolution or flip a
  // passing command to timeout (resolve on exit, not on pipe close) ---
  it('resolves a passing command fast and never reports it as timed out, even with a lingering pipe holder', async () => {
    tmp = makeTmp();
    const run = script(
      tmp,
      'lingerer.js',
      `const cp=require('child_process'); cp.spawn(${JSON.stringify(NODE)}, ['-e','setTimeout(()=>process.exit(0),300)'], {stdio:'inherit'}); process.exit(0);`,
    );
    const res = await runCommand({ run, label: 'lingerer' }, 0, {
      cwd: tmp,
      timeoutMs: 2000,
    });

    expect(res.status).toBe('pass');
    expect(res.exitCode).toBe(0);
    // Resolved on the parent's exit, not when the 300ms grandchild closed the pipe.
    expect(res.timedOut).toBeFalsy();
    expect(res.durationMs).toBeLessThan(1000);
  });

  // --- Acceptance: interleaved stdout/stderr order preserved ---
  it('preserves interleaved stdout/stderr arrival order', async () => {
    tmp = makeTmp();
    const run = script(
      tmp,
      'interleave.js',
      `for (let i=0;i<5;i++){ process.stdout.write('out'+i+'\\n'); process.stderr.write('err'+i+'\\n'); }`,
    );
    // Merge both streams onto one pipe so the emitted interleaving order is
    // deterministic: the runner must preserve that arrival order, not scramble it.
    const res = await runCommand({ run: `${run} 2>&1`, label: 'interleave' }, 0, { cwd: tmp });

    const expected = 'out0\nerr0\nout1\nerr1\nout2\nerr2\nout3\nerr3\nout4\nerr4\n';
    expect(res.output).toBe(expected);
    // First/last markers in place.
    expect(res.output.startsWith('out0\nerr0\n')).toBe(true);
    expect(res.output.endsWith('out4\nerr4\n')).toBe(true);
  });

  // --- Acceptance: memory cap holds under log spew; tail kept, head dropped ---
  it('caps captured output at a memory limit (ring buffer) and keeps the tail', async () => {
    tmp = makeTmp();
    const run = script(
      tmp,
      'spew.js',
      `for (let i=0;i<10000;i++){ process.stdout.write('line'+String(i).padStart(5,'0')+'\\n'); }`,
    );
    const res = await runCommand({ run, label: 'spew' }, 0, {
      cwd: tmp,
      maxOutputBytes: 1024,
    });

    const bytes = Buffer.byteLength(res.output, 'utf8');
    expect(bytes).toBeLessThanOrEqual(1024 + 64);
    // Tail kept: highest-index line present; oldest dropped.
    expect(res.output).toContain('line09999');
    expect(res.output).not.toContain('line00000');
  });

  // --- Acceptance: multi-byte UTF-8 split across chunks decodes intact ---
  it('decodes multi-byte UTF-8 split across chunks without corruption', async () => {
    tmp = makeTmp();
    const payload = '中'.repeat(50000) + 'END_MARKER';
    const run = script(tmp, 'utf8.js', `process.stdout.write(${JSON.stringify(payload)});`);
    const res = await runCommand({ run, label: 'utf8' }, 0, { cwd: tmp });

    expect(res.output).toBe(payload);
    expect(res.output).toContain('END_MARKER');
    expect(res.output).not.toContain('�');
  });

  // --- Acceptance: byte-domain truncation (cap in bytes, keep tail) ---
  describe('truncateTail (byte domain)', () => {
    it('caps in bytes, keeps the tail, and drops the oldest', () => {
      const text = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
      const out = truncateTail(text, 30);
      expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(30);
      expect(out).toContain('line19');
      expect(out).not.toContain('line0');
    });

    it('never cuts a multi-byte character in half', () => {
      const text = '中'.repeat(100) + 'X'; // 中 = 3 bytes each
      const out = truncateTail(text, 10);
      expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(10);
      expect(out).toContain('X');
      expect(out).toContain('中');
      expect(out).not.toContain('�');
    });

    it('keeps the last lines when the cap is small', () => {
      const text = Array.from({ length: 100 }, (_, i) => `line${String(i).padStart(2, '0')}`).join('\n');
      const out = truncateTail(text, 24);
      expect(out).toContain('line99');
      expect(out).not.toContain('line00');
    });
  });

  // --- Acceptance: timed-out result renders as (timeout) in the report ---
  it('renders a timed-out command with a (timeout) marker and timeout diagnosis', () => {
    const results: CommandResult[] = [
      {
        index: 0,
        label: 'npm run --if-present test',
        run: 'npm run --if-present test',
        status: 'fail',
        exitCode: null,
        output: 'Exceeded timeout of 5000 ms for a test',
        durationMs: 5000,
        timedOut: true,
        diagnosis: { klass: 'timeout', hint: 'The command exceeded its execution-time budget.' },
      },
    ];
    const options: ReportOptions = {
      profile: PROFILES[0]!,
      results,
      directory: '/tmp/dsh',
    };
    const report = renderReport(options);
    expect(report).toContain('(timeout)');
    expect(report).toContain('Diagnosis: timeout');
    expect(report).not.toContain('(exit ');
  });

  // --- Acceptance: full log written to temp file with path surfaced; tail kept ---
  it('surfaces the full-log temp path and keeps the tail in the preview (node-large-output)', async () => {
    tmp = makeTmp();
    const fixture = join(import.meta.dirname, 'fixtures', 'node-large-output');
    // Copy fixture so npm can run offline.
    const { cpSync } = await import('node:fs');
    cpSync(fixture, tmp, { recursive: true });

    // Exercise the real self_debug path by importing lazily to avoid a cycle.
    const { selfDebug } = await import('../src/self-debug.ts');
    const report = await selfDebug({ directory: tmp });

    const m = report.match(/^full output: (.+)$/m);
    expect(m).toBeTruthy();
    const logPath = m![1]!;
    expect(existsSync(logPath)).toBe(true);
    const full = readFileSync(logPath, 'utf8');
    expect(full.split('\n').filter((l) => l.startsWith('payload')).length).toBe(200);
    // Preview keeps the tail, not the head.
    expect(report).toContain('payload line 200');
    expect(report).not.toContain('payload line 001');
  });
});

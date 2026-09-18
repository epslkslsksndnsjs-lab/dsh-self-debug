import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/runner.ts';

// Process seam: behaviour we can only observe with real subprocesses.
// Confirms the runner resolves on the child process `exit` event, NOT on the
// stdout/stderr pipe `close` event (which a lingering grandchild would block).
describe('runner seam (real subprocess behaviour)', () => {
  it('resolves on process exit, not on pipe close, when a grandchild holds the pipe open', async () => {
    // Parent exits 0 immediately; the grandchild keeps the inherited stdout
    // pipe open for ~300ms. A pipe-close wait would block for 300ms+.
    const cmd = {
      run: "node -e \"const c=require('child_process').spawn('node',['-e','setTimeout(()=>process.exit(0),300)'],{stdio:'inherit'});process.exit(0)\"",
      label: 'lingering-grandchild',
    };
    const res = await runCommand(cmd, 0, { cwd: process.cwd() });

    expect(res.status).toBe('pass');
    expect(res.exitCode).toBe(0);
    // Resolved well before the 300ms grandchild would have closed the pipe.
    expect(res.durationMs).toBeLessThan(200);
  });

  it('captures the exit code and a duration for a failing command', async () => {
    const cmd = { run: "node -e \"process.exit(7)\"", label: 'exit-7' };
    const res = await runCommand(cmd, 0, { cwd: process.cwd() });

    expect(res.status).toBe('fail');
    expect(res.exitCode).toBe(7);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });
});

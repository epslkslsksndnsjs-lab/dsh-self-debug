import { describe, expect, it } from 'vitest';
import { classify, diagnose, HINTS, type FailureClass } from '../src/diagnosis.ts';

// Pure decision-tree seam: behaviour observable from strings alone, no subprocess.
// The classifier maps a failed command's captured output to one of the six
// fixed taxonomy classes; `unknown` is a first-class outcome (ADR-0001).

describe('diagnosis decision tree v0 (node-pipeline reachable classes)', () => {
  const cases: Array<{ klass: FailureClass; sample: string }> = [
    {
      klass: 'assertion_failure',
      sample: 'assertion failed: expected 2 but got 3',
    },
    {
      klass: 'build_error',
      sample: "src/index.ts(1,1): error TS2304: Cannot find name 'foo'",
    },
    {
      klass: 'timeout',
      sample: 'Exceeded timeout of 5000 ms for a test\n    at async Test.run',
    },
    {
      klass: 'environment_error',
      sample: 'Error: spawnSync definitely_missing_cmd_xyz ENOENT',
    },
    {
      klass: 'permission_error',
      sample: "Error: EACCES: permission denied, open '/etc/dsh-probe'",
    },
    {
      klass: 'unknown',
      sample: 'mysterious gremlin intercepted the process mid-flight',
    },
  ];

  for (const { klass, sample } of cases) {
    it(`classifies ${klass} from its signature output`, () => {
      expect(classify(sample)).toBe(klass);
    });
  }

  it('returns unknown for output that matches no class', () => {
    expect(classify('')).toBe('unknown');
    expect(classify('just some boring stdout noise')).toBe('unknown');
  });

  it('attaches the fixed hint for every class', () => {
    const signatures: Record<FailureClass, string> = {
      assertion_failure: 'assertion failed: expected 2 but got 3',
      build_error: "src/index.ts(1,1): error TS2304: Cannot find name 'foo'",
      timeout: 'Exceeded timeout of 5000 ms for a test',
      environment_error: 'Error: spawnSync missing_cmd ENOENT',
      permission_error: "Error: EACCES: permission denied, open '/etc/x'",
      unknown: 'mysterious gremlin intercepted the process',
    };
    for (const klass of Object.keys(HINTS) as FailureClass[]) {
      const d = diagnose(signatures[klass]!);
      expect(d.klass).toBe(klass);
      const lines = d.hint.split('\n').filter((l) => l.trim().length > 0);
      // ADR-0001: hint is 2-4 lines.
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(4);
    }
  });

  it('diagnose output for a real signature carries the slug and hint text', () => {
    const d = diagnose('assertion failed: expected 2 but got 3');
    expect(d.klass).toBe('assertion_failure');
    expect(d.hint).toContain('test assertion failed');
  });
});

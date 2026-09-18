// Diagnosis decision tree v0 — the tool's differentiator (ADR-0001 §Failure
// taxonomy / §Diagnosis layer). Pure, dependency-free: classification is a
// function of the failed command's captured output only. `unknown` is a
// first-class outcome — a wrong hint is more poisonous than no hint, so an
// unrecognised failure is reported honestly rather than forced into a class.

export type FailureClass =
  | 'build_error'
  | 'assertion_failure'
  | 'timeout'
  | 'environment_error'
  | 'permission_error'
  | 'unknown';

export interface Diagnosis {
  /** Fixed taxonomy slug (see ADR-0001). */
  klass: FailureClass;
  /** Fixed 2-4 line next-step investigation hint (engineer's triage order). */
  hint: string;
}

// Ordered: first match wins. Coarser, higher-priority environmental signals
// (missing tool / denied access) are checked before the failure-shape classes
// so a missing-binary crash is never mistaken for an assertion failure.
const PATTERNS: ReadonlyArray<readonly [FailureClass, RegExp]> = [
  [
    'environment_error',
    /command not found|not recognized as|enoent|no such file or directory|cannot find module|module not found|program is not installed|spawn .* enoent/i,
  ],
  ['permission_error', /eacces|permission denied|operation not permitted/i],
  [
    'timeout',
    /timed out|exceeded timeout|etimedout|timeout of \d+ ms|timeouterror/i,
  ],
  [
    'build_error',
    /error ts\d+|failed to compile|compilation error|syntaxerror|cannot find name|is not assignable to|rollup.*error|webpack.*error|tsc:|type error/i,
  ],
  [
    'assertion_failure',
    /assertion ?failed|assertionerror|expected .* (but|to be|to equal)|expect\(.*\)\.(tobe|toequal|tostrictequal)|\b✕|\b✗|\bassert\(/i,
  ],
];

/** Map a failed command's captured output to a fixed failure-class slug. */
export function classify(output: string): FailureClass {
  for (const [klass, pattern] of PATTERNS) {
    if (pattern.test(output)) {
      return klass;
    }
  }
  return 'unknown';
}

// Fixed hints, 2-4 lines each (ADR-0001). Sub-distinctions live in the hint
// text, not in new classes, to keep ~3-4 calibration samples per real class.
export const HINTS: Record<FailureClass, string> = {
  build_error: [
    'Compilation, transpile, or typecheck failed before any test ran.',
    'Read the error location (file:line) and fix the type/syntax issue.',
    'Re-run the build step in isolation to confirm it resolves.',
  ].join('\n'),
  assertion_failure: [
    'A test assertion failed: actual output diverged from expected.',
    'Inspect the failing assertion and the diff between expected and actual.',
    'Re-run the single test to confirm the exact mismatch.',
  ].join('\n'),
  timeout: [
    'The command exceeded its execution-time budget (or a test timed out).',
    'Check for deadlocks, unbounded loops, slow I/O, or raise the timeout.',
    'Re-run with a longer timeout or narrower scope to isolate the hang.',
  ].join('\n'),
  environment_error: [
    'A required tool, binary, or dependency was missing (command not found / ENOENT).',
    'Install the missing dependency or activate the correct environment/venv.',
    'Confirm the toolchain is on PATH and the project install step succeeded.',
  ].join('\n'),
  permission_error: [
    'The command was denied by the filesystem or sandbox (EACCES / permission denied).',
    'Check file/directory ownership and whether the sandbox allows the path.',
    'Relax the permission, move the target to a writable path, or run with rights.',
  ].join('\n'),
  unknown: [
    'The failure matched no known class; the captured output is the evidence.',
    'Read the full log on disk to identify the root cause directly.',
    'If a pattern recurs, file an issue to extend the decision tree.',
  ].join('\n'),
};

/** Classify and attach the fixed hint. */
export function diagnose(output: string): Diagnosis {
  const klass = classify(output);
  return { klass, hint: HINTS[klass] };
}

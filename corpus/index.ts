// Calibration corpus loader (ADR-0001 §Calibration corpus / issue #5).
//
// The corpus is a directory of admitted cases. Each case is a folder under
// `cases/` containing exactly two files:
//
//   output.txt    — the captured command output (verbatim, as a text fixture)
//   expected.json — { "slugs": ["<failure_class>", ...] }
//
// `slugs` is a *list* so a case may admit more than one acceptable class (e.g.
// output that could honestly be either of two classes). Admission rule
// (ADR-0001): a case enters the corpus only if the current decision tree
// classifies it into one of its `slugs`. A misclassification is a tree
// regression that must turn the admission gate red.
//
// This module is the single source of truth read by both the vitest admission
// test (test/corpus-admission.test.ts) and the standalone gate
// (scripts/admit.ts), so the two can never drift.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CorpusCase {
  /** Folder name; stable, human-readable id. */
  id: string;
  /** Verbatim captured output (the text fixture). */
  output: string;
  /** Expected taxonomy slug(s) — admission passes if classify(output) is one of these. */
  slugs: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(here, 'cases');

/** Every admitted corpus case, sorted by id for a stable gate order. */
export const CORPUS: CorpusCase[] = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const dir = join(CASES_DIR, entry.name);
    const output = readFileSync(join(dir, 'output.txt'), 'utf8');
    const parsed = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as {
      slugs: string[];
    };
    return { id: entry.name, output, slugs: parsed.slugs };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

/** The six fixed taxonomy slugs (ADR-0001 §Failure taxonomy). */
export const ALL_SLUGS = [
  'build_error',
  'assertion_failure',
  'timeout',
  'environment_error',
  'permission_error',
  'unknown',
] as const;

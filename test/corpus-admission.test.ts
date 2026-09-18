import { describe, expect, it } from 'vitest';
import { classify, type FailureClass } from '../src/diagnosis.ts';
import { CORPUS, ALL_SLUGS } from '../corpus/index.ts';

// Corpus admission gate (issue #5). The calibration corpus is the regression
// fence for the diagnosis tree: each admitted case is ONE assertion, so any
// classification regression turns exactly that test red. `unknown` may appear
// only for genuinely unclassifiable output — it is never a forced fallback.

describe('corpus admission (each admitted case = one assertion)', () => {
  for (const c of CORPUS) {
    it(`admits "${c.id}" into ${c.slugs.join(' | ')}`, () => {
      const got = classify(c.output);
      expect(c.slugs, `case "${c.id}" classified as ${got}`).toContain(got);
    });
  }

  // unknown is produced, never forced: only corpus cases that list `unknown`
  // may classify to it; everything else must land in a real class.
  for (const c of CORPUS) {
    const expectsUnknown = c.slugs.includes('unknown');
    it(`keeps "${c.id}" honest about unknown (${expectsUnknown ? 'may be unknown' : 'must be classified'})`, () => {
      const got = classify(c.output);
      if (expectsUnknown) {
        expect(got).toBe('unknown');
      } else {
        expect(got).not.toBe('unknown');
      }
    });
  }

  // Coverage guard: the corpus must exercise every taxonomy slug so the tree
  // cannot silently drop a class (ADR-0001 §Failure taxonomy).
  it('reaches all six taxonomy slugs', () => {
    const covered = new Set<string>(CORPUS.flatMap((c) => c.slugs));
    for (const slug of ALL_SLUGS as readonly FailureClass[]) {
      expect(covered.has(slug), `no corpus case covers ${slug}`).toBe(true);
    }
  });

  // Sanity: the classifier never emits a slug outside the taxonomy.
  it('only ever emits a fixed taxonomy slug', () => {
    const allowed = new Set<string>(ALL_SLUGS);
    for (const c of CORPUS) {
      expect(allowed.has(classify(c.output))).toBe(true);
    }
  });
});

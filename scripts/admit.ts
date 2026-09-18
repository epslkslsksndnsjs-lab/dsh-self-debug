// Standalone corpus admission gate (issue #5). Runs the REAL classifier from
// src/diagnosis.ts over every admitted corpus case and exits non-zero on the
// first misclassification, so it can guard CI independently of vitest.
//
// Run with: node --experimental-strip-types scripts/admit.ts
// (Node 22.6+ strips types natively; the project pins Node 22.22.2.)

import { classify } from '../src/diagnosis.ts';
import { CORPUS } from '../corpus/index.ts';

let failures = 0;
for (const c of CORPUS) {
  const got = classify(c.output);
  const ok = c.slugs.includes(got);
  if (ok) {
    console.log(`ok    ${c.id} -> ${got}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${c.id}: expected ${c.slugs.join(' | ')} got ${got}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} corpus case(s) misclassified — admission gate RED`);
  process.exit(1);
}
console.log(`\nall ${CORPUS.length} corpus cases classified correctly — admission gate GREEN`);

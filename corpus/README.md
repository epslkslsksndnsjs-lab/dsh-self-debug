# Calibration corpus

The calibration corpus is the regression gate for the diagnosis decision tree
(ADR-0001 §Calibration corpus; issue #4/#5). It is a directory of **admitted
cases** — each case is a real captured command output paired with the failure
class(es) the current tree must classify it as.

## Format

Each case is a folder under `cases/`:

```
cases/
  <case-id>/
    output.txt    # verbatim captured command output (text fixture)
    expected.json # { "slugs": ["<failure_class>", ...] }
```

- `output.txt` — the exact text the runner captured for a failed command. For
  python/go failures these are text fixtures; **no real `go`/`uv` install is
  required** to admit or run them.
- `expected.json` — `slugs` is a *list* of acceptable classes. A case passes
  admission when `classify(output)` is one of them. A list (not a single slug)
  lets a case honestly admit more than one class when the output is ambiguous.

## Admission rule

A case is admitted into the corpus **only if the current decision tree
classifies it correctly** (ADR-0001). When the tree is changed, every admitted
case must still classify into its `slugs`; a misclassification is a tree
regression and must turn the gate red.

`unknown` is a first-class outcome and is used **only** for genuinely
unclassifiable output — it is never a forced fallback for output that matches a
real class.

## Running the gate

- Test table: `npm test` includes `test/corpus-admission.test.ts` — every
  admitted case is one assertion, so any regression is visible as a red test.
- Standalone gate: `npm run admit` (or directly
  `node --experimental-strip-types scripts/admit.ts`) exits non-zero on the
  first misclassification, so it can guard CI independently of vitest.

The loader is `corpus/index.ts`; it is the single source of truth for both the
test table and the standalone gate.

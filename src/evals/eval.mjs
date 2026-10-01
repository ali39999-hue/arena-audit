/**
 * Arena Audit — Evaluation Lab (P10-01, P10-05, P10-06, P10-07)
 *
 * Deterministic benchmark for the EVIDENCE LAYER (no LLM needed, repeatable):
 *   - anchor precision: seeded real findings must resolve to real code lines
 *   - trap rejection:   seeded false references must be rejected (invalid),
 *                       never silently verified
 *
 * The LLM tournament is evaluated separately (P10-02..P10-04 datasets).
 * Deterministic truth first: if anchoring is broken, everything above it is.
 */

import { locateSource } from '../evidence/evidence-store.mjs';

/**
 * Run the deterministic eval over a golden dataset.
 * dataset: { cases: [{ ref: "path:line", expect: "anchored" | "invalid", note }] }
 */
export function runEvidenceEval(root, dataset) {
  const cases = dataset.cases || [];
  let anchored = 0, rejected = 0, wrongAnchors = 0, missedAnchors = 0;
  const failures = [];

  for (const c of cases) {
    const loc = locateSource(root, c.ref, { contextLines: 0 });
    if (c.expect === 'anchored') {
      if (loc.status === 'ok') anchored++;
      else { missedAnchors++; failures.push({ ref: c.ref, expected: 'anchored', got: loc.status }); }
    } else if (c.expect === 'invalid') {
      if (loc.status !== 'ok') rejected++;
      else { wrongAnchors++; failures.push({ ref: c.ref, expected: 'invalid', got: 'ok' }); }
    }
  }

  const total = cases.length || 1;
  return {
    total,
    anchored,
    rejected,
    missedAnchors,
    wrongAnchors,
    precision: anchored + wrongAnchors > 0 ? anchored / (anchored + wrongAnchors) : null,
    recall: anchored + missedAnchors > 0 ? anchored / (anchored + missedAnchors) : null,
    anchorRate: anchored / total,
    failures,
  };
}

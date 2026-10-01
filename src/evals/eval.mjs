/**
 * Arena Audit — Evaluation Lab (P10-01..P10-10, deterministic core)
 *
 * Two benchmarks, both repeatable and LLM-free:
 *  1. Evidence eval: golden refs must anchor; traps must be rejected.
 *  2. Detector eval: seeded bugs must be found by the detector layer;
 *     clean traps must not fire → real precision/recall/F1 per category.
 */

import { locateSource } from '../evidence/evidence-store.mjs';
import { runDetectors } from '../detectors/detectors.mjs';
import { computeDetectionMetrics } from './metrics.mjs';

/**
 * Run the deterministic evidence eval over a golden dataset.
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

/**
 * Run the detector benchmark: seeds are planted bugs; clean traps must not fire.
 */
export function runDetectorEval(root, dataset, files) {
  const findings = runDetectors(root, files);
  const metrics = computeDetectionMetrics(dataset.cases, findings);
  // Trap checks: no finding may exist in a clean trap file; invalid refs must not anchor.
  const trapViolations = [];
  for (const t of dataset.traps || []) {
    if (t.expect === 'no_finding') {
      const hit = findings.find((f) => String(f.path).startsWith(t.ref.replace(/:\d+.*$/, '') + ':'));
      if (hit) trapViolations.push({ trap: t.ref, got: hit.path });
    } else if (t.expect === 'invalid') {
      const loc = locateSource(root, t.ref, { contextLines: 0 });
      if (loc.status === 'ok') trapViolations.push({ trap: t.ref, got: 'anchored' });
    }
  }
  return { findings: findings.length, metrics, trapViolations };
}

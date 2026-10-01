/**
 * Arena Audit — Evaluation Metrics (P10-06..P10-11, deterministic subset)
 * Pure functions, unit-tested. No-Evidence ≠ Pass also applies here:
 * metrics over zero cases are null, not 100.
 */

export function computeDetectionMetrics(cases, findings, { lineTolerance = 2 } = {}) {
  let tp = 0, fp = 0, fn = 0;
  const byCategory = {};
  const bySeverity = { expected: {}, matched: {} };
  const misses = [];
  const falsePositives = [];

  // True positives / false negatives: every planted case must be found.
  for (const c of cases) {
    const cat = (byCategory[c.category] = byCategory[c.category] || { tp: 0, fn: 0, fp: 0 });
    const file = String(c.ref).replace(/:\d+.*$/, '');
    const line = parseInt(String(c.ref).split(':')[1], 10);
    const hit = findings.find((f) => f.detectorId === c.detectorId
      && String(f.path).startsWith(file + ':')
      && Math.abs(parseInt(String(f.path).split(':')[1], 10) - line) <= lineTolerance);
    if (hit) {
      tp++; cat.tp++;
      bySeverity.expected[c.severity] = (bySeverity.expected[c.severity] || 0) + 1;
      bySeverity.matched[c.severity] = (bySeverity.matched[c.severity] || 0) + 1;
    } else {
      fn++; cat.fn++;
      misses.push(c.ref);
    }
  }

  // False positives: detector findings that do not correspond to any planted case.
  const caseKeys = new Set(cases.map((c) => String(c.ref).replace(/:\d+.*$/, '')));
  for (const f of findings) {
    const file = String(f.path).replace(/:\d+.*$/, '');
    const onCase = cases.some((c) => {
      const cFile = String(c.ref).replace(/:\d+.*$/, '');
      const cLine = parseInt(String(c.ref).split(':')[1], 10);
      return c.detectorId === f.detectorId && file === cFile
        && Math.abs(parseInt(String(f.path).split(':')[1], 10) - cLine) <= lineTolerance;
    });
    if (!onCase && !caseKeys.has(file + ':x')) {
      const cat = (byCategory[f.category || f.lens] = byCategory[f.category] || { tp: 0, fn: 0, fp: 0 });
      fp++; cat.fp++;
      falsePositives.push(`${f.path} (${f.detectorId})`);
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? 2 * precision * recall / (precision + recall) : null;

  const categories = Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, {
    precision: v.tp + v.fp > 0 ? v.tp / (v.tp + v.fp) : null,
    recall: v.tp + v.fn > 0 ? v.tp / (v.tp + v.fn) : null,
    tp: v.tp, fp: v.fp, fn: v.fn,
  }]));

  return {
    total: cases.length, tp, fp, fn,
    precision, recall, f1,
    falsePositiveRate: tp + fp > 0 ? fp / (tp + fp) : null,
    severityAccuracy: bySeverity.expected && Object.keys(bySeverity.expected).length
      ? Object.entries(bySeverity.expected).reduce((acc, [s, n]) => acc + (bySeverity.matched[s] || 0), 0) / Object.values(bySeverity.expected).reduce((a, b) => a + b, 0)
      : null,
    categories, misses, falsePositives,
  };
}

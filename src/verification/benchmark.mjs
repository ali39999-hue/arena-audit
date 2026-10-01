/**
 * Arena Audit — Verification & Refutation Benchmark (P2-10..P2-14)
 *
 * Measures VERIFICATION QUALITY as an INDEPENDENTLY OBSERVED metric:
 *  - verificationAccuracy: verifier decisions vs deterministic ground truth
 *    (true findings → 'verified', planted false findings → 'refuted')
 *  - refutationRate: fraction of planted FALSE findings correctly refuted
 *  - independence: provider/model recorded per run (never derived from precision)
 *
 * Rule (roadmap): verificationAccuracy must NOT be computed from precision.
 * This benchmark observes the verifier's own decisions directly.
 */

/**
 * Run the verification benchmark.
 * @param {Object} p
 * @param {Array}  p.trueFindings   — findings that ARE real (ground truth)
 * @param {Array}  p.falseFindings  — findings that are NOT real (planted traps)
 * @param {Function} p.verify — async (finding) => { decision, confidence, severity, note }
 * @param {String} p.provider — verifier provider (recorded for independence)
 * @param {String} p.model — verifier model
 */
export async function runVerificationBenchmark({ trueFindings = [], falseFindings = [], verify, provider = 'unknown', model = 'unknown' }) {
  let correctTrue = 0;   // true → verified
  let missedTrue = 0;    // true → refuted/inconclusive
  let refutedFalse = 0;  // false → refuted
  let acceptedFalse = 0; // false → verified (bad!)

  const decisions = [];

  for (const f of trueFindings) {
    const v = await verify(f);
    decisions.push({ id: f.id, truth: 'true', decision: v.decision });
    if (v.decision === 'verified') correctTrue++;
    else missedTrue++;
  }

  for (const f of falseFindings) {
    const v = await verify(f);
    decisions.push({ id: f.id, truth: 'false', decision: v.decision });
    if (v.decision === 'refuted') refutedFalse++;
    else if (v.decision === 'verified') acceptedFalse++;
  }

  const verificationAccuracy = (trueFindings.length + falseFindings.length) > 0
    ? (correctTrue + refutedFalse) / (trueFindings.length + falseFindings.length)
    : null;

  const refutationRate = falseFindings.length > 0 ? refutedFalse / falseFindings.length : null;
  const trueDetectionRate = trueFindings.length > 0 ? correctTrue / trueFindings.length : null;

  return {
    schemaVersion: 1,
    observed: true, // independently observed — NOT derived from precision
    independence: { provider, model },
    metrics: {
      verificationAccuracy: round(verificationAccuracy),
      refutationRate: round(refutationRate),
      trueDetectionRate: round(trueDetectionRate),
      correctTrue,
      missedTrue,
      refutedFalse,
      acceptedFalse,
      total: trueFindings.length + falseFindings.length,
    },
    decisions,
    timestamp: new Date().toISOString(),
  };
}

function round(v) { return v === null ? null : Math.round(v * 1000) / 1000; }

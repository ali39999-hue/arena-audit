/**
 * Arena Audit — LLM-Judged Evaluation Engine (STEP 2-3)
 *
 * Evaluates audit findings against versioned golden ground-truth across
 * 6 rigorous qualitative and structural dimensions:
 *  1. Finding Quality (clarity, actionability, specificity)
 *  2. Evidence Quality (anchor fidelity, excerpt relevance)
 *  3. Severity Calibration (ground truth alignment)
 *  4. Location Accuracy (exact line & span precision)
 *  5. Reasoning Consistency (verifier logic soundness)
 *  6. Verification Quality (attack/defend accuracy on TP vs FP)
 *
 * Deterministic ground-truth labels remain the PRIMARY reference;
 * the LLM judge provides calibrated meta-evaluation.
 */

import { parseJSONFromText } from '../agents/llm.mjs';

export const JUDGE_WEIGHTS = {
  findingQuality: 0.15,
  evidenceQuality: 0.20,
  severityCalibration: 0.15,
  locationAccuracy: 0.20,
  reasoningConsistency: 0.15,
  verificationQuality: 0.15,
};

/**
 * Evaluate an individual finding against its ground truth case using the judge.
 */
export async function judgeFinding({ judgeLlm, finding, goldenCase, fileExcerpt }) {
  // If no LLM available or mock is requested, provide deterministic scoring
  if (!judgeLlm) {
    return evaluateDeterministically(finding, goldenCase);
  }

  const system = 'You are a Principal Software Quality Judge conducting an independent audit benchmark. Score strictly between 0 and 100 for each dimension. Output strict JSON only.';

  const prompt = [
    'Evaluate the following candidate audit finding against the ground-truth golden benchmark case:',
    '',
    'GROUND TRUTH GOLDEN CASE:',
    JSON.stringify(goldenCase, null, 2),
    '',
    'ACTUAL AUDIT FINDING PRODUCED:',
    JSON.stringify(finding, null, 2),
    '',
    'REAL SOURCE CODE CONTEXT:',
    fileExcerpt || '(no excerpt provided)',
    '',
    'Provide scores (0-100) and brief rationale in strict JSON:',
    '{',
    '  "findingQuality": 0-100,',
    '  "evidenceQuality": 0-100,',
    '  "severityCalibration": 0-100,',
    '  "locationAccuracy": 0-100,',
    '  "reasoningConsistency": 0-100,',
    '  "verificationQuality": 0-100,',
    '  "rationale": "2 sentences explaining the evaluation"',
    '}',
  ].join('\n');

  try {
    const text = await judgeLlm(system, prompt);
    const parsed = parseJSONFromText(text);

    const scores = {
      findingQuality: clampScore(parsed.findingQuality),
      evidenceQuality: clampScore(parsed.evidenceQuality),
      severityCalibration: clampScore(parsed.severityCalibration),
      locationAccuracy: clampScore(parsed.locationAccuracy),
      reasoningConsistency: clampScore(parsed.reasoningConsistency),
      verificationQuality: clampScore(parsed.verificationQuality),
    };

    const compositeScore = Math.round(
      scores.findingQuality * JUDGE_WEIGHTS.findingQuality +
      scores.evidenceQuality * JUDGE_WEIGHTS.evidenceQuality +
      scores.severityCalibration * JUDGE_WEIGHTS.severityCalibration +
      scores.locationAccuracy * JUDGE_WEIGHTS.locationAccuracy +
      scores.reasoningConsistency * JUDGE_WEIGHTS.reasoningConsistency +
      scores.verificationQuality * JUDGE_WEIGHTS.verificationQuality
    );

    return {
      scores,
      compositeScore,
      rationale: parsed.rationale || 'Evaluated by LLM Judge.',
      mode: 'llm-judged',
    };
  } catch (err) {
    // Fallback to deterministic evaluation if judge LLM call fails
    return {
      ...evaluateDeterministically(finding, goldenCase),
      mode: 'deterministic-fallback',
      fallbackReason: err.message,
    };
  }
}

/**
 * Deterministic baseline evaluation for a finding against golden case (no LLM required).
 */
export function evaluateDeterministically(finding, goldenCase) {
  if (!goldenCase) {
    return {
      scores: {
        findingQuality: 70,
        evidenceQuality: finding.evidence ? 80 : 30,
        severityCalibration: 70,
        locationAccuracy: 50,
        reasoningConsistency: 70,
        verificationQuality: 70,
      },
      compositeScore: 70,
      rationale: 'No corresponding golden case found for comparison.',
      mode: 'deterministic',
    };
  }

  // Location accuracy check
  const citedLine = parseInt(String(finding.path || '').split(':')[1], 10);
  const targetLine = goldenCase.expectedLocation?.line;
  const lineDiff = (!isNaN(citedLine) && !isNaN(targetLine)) ? Math.abs(citedLine - targetLine) : 999;
  const locationAccuracy = lineDiff === 0 ? 100 : (lineDiff <= 2 ? 80 : (lineDiff <= 5 ? 50 : 20));

  // Severity calibration
  const severityMatch = (finding.severity || '').toLowerCase() === (goldenCase.expectedSeverity || '').toLowerCase();
  const severityCalibration = severityMatch ? 100 : 50;

  // Evidence quality
  const evidenceQuality = finding.evidence && finding.evidence.length > 10 ? 95 : (finding.evidenceRefs?.length ? 80 : 30);

  // Verification quality
  const statusMatch = (finding.status || '').toLowerCase() === (goldenCase.expectedStatus || '').toLowerCase();
  const verificationQuality = statusMatch ? 100 : 30;

  const findingQuality = finding.problem && finding.problem.length >= 10 ? 90 : 50;
  const reasoningConsistency = finding.verifierNote ? 90 : 60;

  const compositeScore = Math.round(
    findingQuality * JUDGE_WEIGHTS.findingQuality +
    evidenceQuality * JUDGE_WEIGHTS.evidenceQuality +
    severityCalibration * JUDGE_WEIGHTS.severityCalibration +
    locationAccuracy * JUDGE_WEIGHTS.locationAccuracy +
    reasoningConsistency * JUDGE_WEIGHTS.reasoningConsistency +
    verificationQuality * JUDGE_WEIGHTS.verificationQuality
  );

  return {
    scores: {
      findingQuality,
      evidenceQuality,
      severityCalibration,
      locationAccuracy,
      reasoningConsistency,
      verificationQuality,
    },
    compositeScore,
    rationale: `Deterministic match: location-diff=${lineDiff}, severityMatch=${severityMatch}, statusMatch=${statusMatch}.`,
    mode: 'deterministic',
  };
}

/**
 * Full Evaluation Suite: Evaluates all findings against the golden dataset.
 */
export async function evaluateAuditRun({ judgeLlm, findings = [], goldenDataset }) {
  const cases = goldenDataset.cases || [];
  const evaluations = [];

  let matchedCases = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  // Track findings per golden case
  const usedFindings = new Set();

  for (const gold of cases) {
    const goldFile = gold.expectedLocation?.file;
    const goldLine = gold.expectedLocation?.line;

    // Find best candidate matching this golden case
    const match = findings.find((f, idx) => {
      if (usedFindings.has(idx)) return false;
      const file = String(f.path || '').replace(/:\d+.*$/, '');
      const line = parseInt(String(f.path || '').split(':')[1], 10);
      return file.endsWith(goldFile) && Math.abs(line - goldLine) <= 3;
    });

    if (match) {
      usedFindings.add(findings.indexOf(match));
      matchedCases++;

      const isTp = gold.expectedStatus === 'verified' && match.status === 'verified';
      if (isTp) truePositives++;
      else if (gold.expectedStatus === 'refuted' && match.status === 'verified') falsePositives++;

      const evalResult = await judgeFinding({
        judgeLlm,
        finding: match,
        goldenCase: gold,
        fileExcerpt: match.evidence || '',
      });

      evaluations.push({
        caseId: gold.id,
        category: gold.category,
        matched: true,
        finding: match,
        goldenCase: gold,
        ...evalResult,
      });
    } else {
      if (gold.expectedStatus === 'verified') {
        falseNegatives++;
      }
      evaluations.push({
        caseId: gold.id,
        category: gold.category,
        matched: false,
        goldenCase: gold,
        compositeScore: 0,
        rationale: 'Finding was missed by the audit engine (False Negative).',
        mode: 'deterministic',
      });
    }
  }

  // Count unanchored / unassociated findings as potential false positives
  for (let idx = 0; idx < findings.length; idx++) {
    if (!usedFindings.has(idx)) {
      const extra = findings[idx];
      if (extra.status === 'verified') {
        falsePositives++;
      }
    }
  }

  const precision = (truePositives + falsePositives > 0) ? (truePositives / (truePositives + falsePositives)) : 1.0;
  const recall = (truePositives + falseNegatives > 0) ? (truePositives / (truePositives + falseNegatives)) : 1.0;
  const f1 = (precision + recall > 0) ? ((2 * precision * recall) / (precision + recall)) : 0;

  // Average judge dimension scores
  const scoreTotals = { findingQuality: 0, evidenceQuality: 0, severityCalibration: 0, locationAccuracy: 0, reasoningConsistency: 0, verificationQuality: 0 };
  let scoredCount = 0;

  for (const e of evaluations) {
    if (e.scores) {
      for (const [key, val] of Object.entries(e.scores)) {
        scoreTotals[key] += val;
      }
      scoredCount++;
    }
  }

  const dimensionAverages = {};
  for (const [key, total] of Object.entries(scoreTotals)) {
    dimensionAverages[key] = scoredCount > 0 ? Math.round(total / scoredCount) : 0;
  }

  const averageCompositeScore = scoredCount > 0
    ? Math.round(evaluations.reduce((acc, e) => acc + (e.compositeScore || 0), 0) / scoredCount)
    : 0;

  return {
    datasetName: goldenDataset.name,
    datasetVersion: goldenDataset.schemaVersion || '2.0.0',
    totalCases: cases.length,
    matchedCases,
    metrics: {
      truePositives,
      falsePositives,
      falseNegatives,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
    },
    dimensionAverages,
    averageCompositeScore,
    evaluations,
    timestamp: new Date().toISOString(),
  };
}

function clampScore(val) {
  const num = Number(val);
  if (isNaN(num)) return 70;
  return Math.max(0, Math.min(100, Math.round(num)));
}

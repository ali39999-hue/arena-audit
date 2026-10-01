import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateDeterministically, judgeFinding, evaluateAuditRun, JUDGE_WEIGHTS } from '../../src/evals/llm-judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '..', 'fixtures', 'eval-platform', 'manifest.json');

test('eval-platform dataset is versioned and covers all 8 required categories', () => {
  const dataset = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  assert.equal(dataset.schemaVersion, '2.0.0');
  assert.ok(dataset.cases.length >= 8);

  const categories = new Set(dataset.cases.map(c => c.category));
  const requiredCategories = [
    'correctness',
    'security',
    'architecture',
    'testing',
    'performance',
    'false_positive',
    'ambiguous',
    'safe_pattern',
  ];

  for (const req of requiredCategories) {
    assert.ok(categories.has(req), `Category ${req} must be present in dataset`);
  }

  for (const c of dataset.cases) {
    assert.ok(c.id);
    assert.ok(c.repository);
    assert.ok(c.commit);
    assert.ok(c.expectedFinding);
    assert.ok(c.expectedLocation?.file);
    assert.ok(c.expectedLocation?.line);
    assert.ok(c.expectedSeverity);
    assert.ok(c.expectedStatus);
    assert.ok(c.evidence?.excerpt);
  }
});

test('evaluateDeterministically scores exact matches with 100 in precision and severity', () => {
  const golden = {
    id: 'CASE-01',
    expectedLocation: { file: 'test.ts', line: 42 },
    expectedSeverity: 'high',
    expectedStatus: 'verified',
  };
  const finding = {
    path: 'test.ts:42',
    severity: 'high',
    status: 'verified',
    problem: 'Critical security flaw',
    evidence: 'export function insecure() { ... }',
    verifierNote: 'Independently confirmed by verifier.',
  };

  const res = evaluateDeterministically(finding, golden);
  assert.equal(res.scores.locationAccuracy, 100);
  assert.equal(res.scores.severityCalibration, 100);
  assert.equal(res.scores.verificationQuality, 100);
  assert.ok(res.compositeScore >= 90);
});

test('evaluateDeterministically penalizes line drift and status mismatch', () => {
  const golden = {
    id: 'CASE-02',
    expectedLocation: { file: 'test.ts', line: 10 },
    expectedSeverity: 'high',
    expectedStatus: 'verified',
  };
  const finding = {
    path: 'test.ts:25', // 15 lines off
    severity: 'low',     // mismatch
    status: 'refuted',   // mismatch
    problem: 'Minor issue',
  };

  const res = evaluateDeterministically(finding, golden);
  assert.ok(res.scores.locationAccuracy <= 20);
  assert.ok(res.scores.severityCalibration <= 50);
  assert.ok(res.scores.verificationQuality <= 30);
  assert.ok(res.compositeScore < 50);
});

test('judgeFinding falls back safely if judge LLM throws or fails', async () => {
  const golden = {
    expectedLocation: { file: 'test.ts', line: 10 },
    expectedSeverity: 'medium',
    expectedStatus: 'verified',
  };
  const finding = { path: 'test.ts:10', severity: 'medium', status: 'verified', problem: 'valid problem' };

  const brokenLlm = async () => { throw new Error('API timeout'); };
  const res = await judgeFinding({ judgeLlm: brokenLlm, finding, goldenCase: golden });
  assert.equal(res.mode, 'deterministic-fallback');
  assert.ok(res.compositeScore > 0);
});

test('judgeFinding with mock LLM returns parsed qualitative dimensions', async () => {
  const golden = {
    expectedLocation: { file: 'test.ts', line: 10 },
    expectedSeverity: 'high',
    expectedStatus: 'verified',
  };
  const finding = { path: 'test.ts:10', severity: 'high', status: 'verified', problem: 'valid problem' };

  const mockLlm = async () => JSON.stringify({
    findingQuality: 92,
    evidenceQuality: 95,
    severityCalibration: 90,
    locationAccuracy: 100,
    reasoningConsistency: 88,
    verificationQuality: 94,
    rationale: 'Excellent fidelity and clean line alignment.',
  });

  const res = await judgeFinding({ judgeLlm: mockLlm, finding, goldenCase: golden });
  assert.equal(res.mode, 'llm-judged');
  assert.equal(res.scores.locationAccuracy, 100);
  assert.equal(res.scores.evidenceQuality, 95);
  assert.ok(res.compositeScore >= 90);
  assert.match(res.rationale, /Excellent fidelity/);
});

test('evaluateAuditRun produces composite metrics and dimension averages', async () => {
  const dataset = {
    name: 'test-dataset',
    schemaVersion: '2.0.0',
    cases: [
      { id: 'C1', category: 'security', expectedLocation: { file: 'src/a.ts', line: 5 }, expectedSeverity: 'high', expectedStatus: 'verified' },
      { id: 'C2', category: 'correctness', expectedLocation: { file: 'src/b.ts', line: 12 }, expectedSeverity: 'medium', expectedStatus: 'verified' },
    ],
  };

  const findings = [
    { path: 'src/a.ts:5', severity: 'high', status: 'verified', problem: 'Sec issue' },
    // C2 is missed (FN)
    { path: 'src/ghost.ts:1', severity: 'high', status: 'verified', problem: 'Invented' }, // extra (FP)
  ];

  const report = await evaluateAuditRun({ judgeLlm: null, findings, goldenDataset: dataset });
  assert.equal(report.totalCases, 2);
  assert.equal(report.metrics.truePositives, 1);
  assert.equal(report.metrics.falsePositives, 1);
  assert.equal(report.metrics.falseNegatives, 1);
  assert.equal(report.metrics.precision, 0.5);
  assert.equal(report.metrics.recall, 0.5);
  assert.ok(report.averageCompositeScore > 0);
  assert.ok(report.dimensionAverages.locationAccuracy > 0);
});

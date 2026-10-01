import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDetectors } from '../../src/detectors/detectors.mjs';
import { generateDataset, TEMPLATES } from '../../src/evals/dataset.mjs';
import { computeDetectionMetrics } from '../../src/evals/metrics.mjs';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arena-det-'));
  mkdirSync(join(root, 'src'), { recursive: true });
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ }
});

const write = (rel, content) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
};

const files = (paths) => paths.map((p) => ({ path: p, kind: 'source' }));

test('every planted template fires its detector at the exact line', () => {
  // Build one file per template via the generator's own builders.
  let n = 0;
  const paths = [];
  const expected = [];
  for (const [id, tpl] of Object.entries(TEMPLATES)) {
    const ext = id === 'py-eval-usage' ? 'py' : 'ts';
    const rel = `src/${id}.${ext}`;
    const { content, bugLine } = tpl.build(1);
    write(rel, content);
    paths.push(rel);
    expected.push({ id, line: bugLine });
    n++;
  }
  const findings = runDetectors(root, files(paths));
  for (const { id, line } of expected) {
    const hit = findings.find((f) => f.detectorId === id && String(f.path).startsWith(`src/${id}.`) && parseInt(String(f.path).split(':')[1], 10) === line);
    assert.ok(hit, `detector ${id} must fire at line ${line}`);
    assert.ok(hit.evidence.length > 0, 'finding carries excerpt evidence');
  }
  assert.equal(findings.length, n, 'no extra findings beyond the planted ones');
});

test('clean analogues do not fire (FP discipline)', () => {
  write('src/clean.ts', [
    'export const t = token({ expires: 3600 });',
    "localStorage.setItem('ui-theme', 'dark');",
    'export const total = items.length * 2;',
    'try { go(); } catch (err) { logger.warn(err); }',
    'const q = "SELECT * FROM users WHERE id = ?";',
  ].join('\n'));
  const findings = runDetectors(root, files(['src/clean.ts']));
  assert.equal(findings.length, 0, `clean file must produce zero findings, got ${JSON.stringify(findings.map((f) => f.path))}`);
});

test('non-source entries are skipped', () => {
  const findings = runDetectors(root, [{ path: 'src/x.ts', kind: 'binary' }]);
  assert.equal(findings.length, 0);
});

// ── Dataset generator (P10-02/03) ────────────────────────────────────────────

test('generated dataset is seeded and reproducible', () => {
  const rootA = mkdtempSync(join(tmpdir(), 'arena-ds-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'arena-ds-b-'));
  const a = generateDataset(rootA, { size: 14, seed: 7 });
  const b = generateDataset(rootB, { size: 14, seed: 7 });
  assert.deepEqual(a.cases, b.cases, 'same seed → same case set');
  assert.ok(a.cases.every((c) => c.expect === 'anchored' && c.detectorId));
  const c = generateDataset(rootA, { size: 14, seed: 8 });
  assert.notDeepEqual(a.cases, c.cases, 'different seed → different dataset');
  rmSync(rootA, { recursive: true, force: true });
  rmSync(rootB, { recursive: true, force: true });
});

test('full eval loop: detectors find every planted bug, zero trap violations', () => {
  const dataset = datasetModule.generateDataset(root, { size: 8, seed: 3 });
  const paths = dataset.cases.map((c) => c.ref.replace(/:\d+.*$/, ''))
    .concat(['src/clean/token.ts', 'src/clean/theme.ts', 'src/clean/math.ts', 'src/clean/handler.ts', 'src/clean/query.ts']);
  const findings = runDetectors(root, files([...new Set(paths)]));
  const metrics = computeDetectionMetrics(dataset.cases, findings);
  assert.equal(metrics.fn, 0, 'every planted bug must be found');
  assert.equal(metrics.precision, 1);
  assert.equal(metrics.recall, 1);
});

import * as datasetModule from '../../src/evals/dataset.mjs';

// ── Metrics (P10-06..08) ─────────────────────────────────────────────────────

test('metrics compute TP/FP/FN with category split and severity accuracy', () => {
  const cases = [
    { ref: 'a.ts:1', detectorId: 'd1', category: 'security', severity: 'high' },
    { ref: 'a.ts:10', detectorId: 'd1', category: 'security', severity: 'medium' },
    { ref: 'b.ts:5', detectorId: 'd2', category: 'correctness', severity: 'low' },
  ];
  const findings = [
    { detectorId: 'd1', path: 'a.ts:2', category: 'security', severity: 'high' },   // TP (tolerance 2)
    { detectorId: 'd1', path: 'a.ts:10', category: 'security', severity: 'medium' }, // TP exact
    { detectorId: 'd1', path: 'zz.ts:1', category: 'security', severity: 'high' },  // FP
    // b.ts:5 missed → FN
  ];
  const m = computeDetectionMetrics(cases, findings);
  assert.equal(m.tp, 2);
  assert.equal(m.fp, 1);
  assert.equal(m.fn, 1);
  assert.equal(m.precision, 2 / 3);
  assert.equal(m.recall, 2 / 3);
  assert.equal(m.categories.security.tp, 2);
  assert.equal(m.categories.correctness.fn, 1);
  assert.equal(m.severityAccuracy, 1); // both TPs kept their expected severity
});

test('metrics over zero cases are null, not 100 (NOT CHECKED ≠ PASS)', () => {
  const m = computeDetectionMetrics([], []);
  assert.equal(m.precision, null);
  assert.equal(m.recall, null);
});

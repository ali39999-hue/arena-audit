import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSymbolIndex, buildImportGraph, createSemanticQueries } from '../../src/semantic/symbols.mjs';
import { gitDelta, scopeFiles } from '../../src/git/delta.mjs';
import { toSarif } from '../../src/outputs/sarif.mjs';
import { runEvidenceEval } from '../../src/evals/eval.mjs';
import { findRelatedTests } from '../../src/verification/reproduce.mjs';

let root;
let files;
let index;
let graph;
let semantic;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arena-sem-'));
  mkdirSync(join(root, 'src', 'payments'), { recursive: true });
  mkdirSync(join(root, 'src', 'util'), { recursive: true });
  writeFileSync(join(root, 'src', 'payments', 'charge.ts'), [
    'import { log } from "../util/logger.js";',
    'export function charge(card, amount) {',
    '  log("charge", amount);',
    '  return { ok: true };',
    '}',
  ].join('\n'));
  writeFileSync(join(root, 'src', 'util', 'logger.ts'), [
    'export function log(msg, data) {',
    '  console.log(msg, data);',
    '}',
  ].join('\n'));
  writeFileSync(join(root, 'src', 'payments', 'charge.test.ts'), [
    'import { charge } from "./charge.js";',
    'import { test } from "node:test";',
    'test("charges", () => {});',
  ].join('\n'));
  files = [
    { path: 'src/payments/charge.ts', kind: 'source' },
    { path: 'src/util/logger.ts', kind: 'source' },
    { path: 'src/payments/charge.test.ts', kind: 'source' },
  ];
  index = buildSymbolIndex(files, root);
  graph = buildImportGraph(files, root);
  semantic = createSemanticQueries(index, graph, root);
});

// ── P4: Semantic layer ───────────────────────────────────────────────────────

test('symbol index finds exported functions with exact lines (LLM-free)', () => {
  const hits = semantic.findSymbol('charge');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'src/payments/charge.ts');
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].kind, 'function');
});

test('import graph resolves relative imports to workspace paths', () => {
  assert.deepEqual(semantic.importedBy('src/util/logger.ts'), ['src/payments/charge.ts']);
  assert.deepEqual(semantic.importedBy('src/payments/charge.ts'), ['src/payments/charge.test.ts']);
});

test('impactOf expands importers transitively and finds related tests', () => {
  const impact = semantic.impactOf(['src/util/logger.ts'], { depth: 2 });
  assert.ok(impact.direct.includes('src/payments/charge.ts'));
  assert.ok(impact.transitive.includes('src/payments/charge.test.ts'));
  assert.ok(impact.tests.some((t) => t.includes('charge.test.ts')));
});

test('findReferences distinguishes definition vs reference with lines', () => {
  const refs = semantic.findReferences('charge');
  const def = refs.find((r) => r.kind === 'definition');
  assert.ok(def, 'definition must be found');
  assert.equal(def.line, 2);
  assert.ok(refs.some((r) => r.file === 'src/payments/charge.test.ts' && r.kind === 'reference'));
});

// ── P11: Diff-aware scope ────────────────────────────────────────────────────

test('gitDelta reports not-a-repo honestly outside git', () => {
  const d = gitDelta(root);
  assert.equal(d.available, false);
});

test('target scope filters the file inventory to the subtree', () => {
  const snapshot = { allFiles: files };
  const { scopedFiles, scopeNote } = scopeFiles(root, snapshot, 'target', { target: 'src/payments' });
  assert.equal(scopedFiles.length, 2);
  assert.match(scopeNote, /targeted: src\/payments/);
});

// ── P12: SARIF ───────────────────────────────────────────────────────────────

test('SARIF output is 2.1.0 with rules, results, levels and fingerprints', () => {
  const findings = [
    { lens: 'security', path: 'src/a.ts:42', problem: 'hardcoded secret', severity: 'high', status: 'verified', confidence: 0.95, fingerprint: 'fp1' },
    { lens: 'correctness', path: 'src/b.ts:7', problem: 'off-by-one', severity: 'medium', status: 'refuted', confidence: 0.4, fingerprint: 'fp2' },
  ];
  const sarif = toSarif({ projectName: 'demo', findings, gates: [{ id: 'typecheck', status: 'pass' }] });
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].results.length, 2);
  const r0 = sarif.runs[0].results[0];
  assert.equal(r0.level, 'error');
  assert.equal(r0.locations[0].physicalLocation.region.startLine, 42);
  assert.equal(r0.properties.status, 'verified');
  assert.equal(sarif.runs[0].results[1].level, 'warning'); // refuted still exported, filterable
  assert.equal(sarif.runs[0].properties.gates.typecheck, 'pass');
});

test('SARIF rules array has no duplicates (GitHub upload validation)', () => {
  const findings = [
    { lens: 'security', path: 'src/a.ts:1', problem: 'x', severity: 'high', status: 'verified', confidence: 0.9, fingerprint: 'dup' },
    { lens: 'security', path: 'src/a.ts:5', problem: 'x (dup)', severity: 'high', status: 'verified', confidence: 0.9, fingerprint: 'dup' },
  ];
  const sarif = toSarif({ projectName: 'demo', findings, gates: [] });
  const ruleIds = sarif.runs[0].tool.driver.rules.map((r) => r.id);
  assert.equal(new Set(ruleIds).size, ruleIds.length, 'rule ids must be unique');
});

// ── P10: Evaluation lab ──────────────────────────────────────────────────────

test('evidence eval scores anchors and traps honestly', () => {
  const dataset = {
    cases: [
      { ref: join('src', 'payments', 'charge.ts').replace(/\\/g, '/') + ':3', expect: 'anchored' },
      { ref: join('src', 'payments', 'charge.ts').replace(/\\/g, '/') + ':999', expect: 'invalid' },
      { ref: 'src/ghost.ts:1', expect: 'invalid' },
    ],
  };
  const r = runEvidenceEval(root, dataset);
  assert.equal(r.anchored, 1);
  assert.equal(r.rejected, 2);
  assert.equal(r.precision, 1);
  assert.equal(r.recall, 1);
  assert.equal(r.failures.length, 0);
});

// ── P6-04: test mapping ──────────────────────────────────────────────────────

test('findRelatedTests maps source → its test via import graph', () => {
  const snapshot = { tests: ['src/payments/charge.test.ts'] };
  const tests = findRelatedTests('src/payments/charge.ts', snapshot, graph);
  assert.ok(tests.includes('src/payments/charge.test.ts'));
});

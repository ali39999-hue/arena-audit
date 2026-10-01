import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CAPABILITY_REGISTRY, generateCapabilityMatrix, generateCapabilityMarkdown, capabilitiesByStatus } from '../../src/core/capability-status.mjs';
import { checkDocumentation } from '../../src/core/doc-check.mjs';
import { buildReleaseManifest, buildReproducibilityManifest, canonicalHash } from '../../src/core/release-manifest.mjs';
import { EvidenceStore } from '../../src/evidence/evidence-store.mjs';
import { runVerificationBenchmark } from '../../src/verification/benchmark.mjs';
import { runTrueMutationTesting } from '../../src/evals/mutation-true.mjs';
import { createSnapshotWorkspace, assertPathInsideSnapshot } from '../../src/sandbox/snapshot.mjs';
import { locateSource } from '../../src/evidence/evidence-store.mjs';

const repoRoot = resolveRepoRoot();
function resolveRepoRoot() {
  let dir = process.cwd();
  while (dir !== '/' && !existsSync(join(dir, 'package.json'))) dir = dirname(dir);
  return dir;
}
import { dirname } from 'node:path';

// ── P0: Capability status registry & doc gate ────────────────────────────────

test('capability registry: statuses valid, counts consistent, no duplicate ids', () => {
  const matrix = generateCapabilityMatrix();
  assert.ok(matrix.capabilities.length >= 30);
  const ids = matrix.capabilities.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const total = Object.values(matrix.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, matrix.capabilities.length);
  assert.equal(capabilitiesByStatus('PLANNED').every((c) => c.status === 'PLANNED'), true);
});

test('doc consistency gate passes on the real repo (no drift)', () => {
  const res = checkDocumentation(repoRoot);
  assert.equal(res.ok, true, res.problems.join('; '));
});

test('doc consistency gate catches drift (version mismatch + missing evidence)', () => {
  // Run against a synthetic root with a stale README
  const dir = mkdtempSync(join(tmpdir(), 'arena-docs-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'arena-audit', version: '9.9.9' }));
  writeFileSync(join(dir, 'README.md'), 'old readme v1.0.0');
  const res = checkDocumentation(dir);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => p.includes('9.9.9')));
  assert.ok(res.problems.some((p) => p.includes('ARCHITECTURE')));
  rmSync(dir, { recursive: true, force: true });
});

test('release manifest: counts + reproducibility manifest hash stability', () => {
  const manifest = buildReleaseManifest(repoRoot, { commit: 'abc' });
  assert.equal(manifest.version, JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')).version);
  assert.ok(manifest.counts.implemented >= 20);
  assert.ok(manifest.testFiles >= 15);

  const repro = buildReproducibilityManifest({
    engineVersion: '3.2.0', mode: 'full', sandbox: 'trusted',
    concurrency: 4, policyProfile: 'OWASP-Top10', goal: 'audit', commit: 'abc',
  });
  assert.match(repro.configHash, /^[a-f0-9]{64}$/);
  const repro2 = buildReproducibilityManifest({
    engineVersion: '3.2.0', mode: 'full', sandbox: 'trusted',
    concurrency: 4, policyProfile: 'OWASP-Top10', goal: 'audit', commit: 'abc',
  });
  assert.equal(repro.configHash, repro2.configHash, 'same config → same hash (deterministic)');
  assert.equal(canonicalHash({ a: 1, b: 2 }), canonicalHash({ b: 2, a: 1 }));
});

// ── P1: Evidence hardening ───────────────────────────────────────────────────

let root;
let store;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arena-evh-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'alpha\nbeta\ngamma\n');
  store = new EvidenceStore(root, 'commit_1');
});

afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

test('evidence path-escape: ../ and traversal refs are rejected (P8-14)', () => {
  const loc = locateSource(root, '../outside.ts:1');
  assert.equal(loc.status, 'path_escape');
  const ev = store.addSource('../outside.ts:1', {});
  assert.equal(ev.type, 'error');
});

test('evidence dedupe removes exact duplicates only', () => {
  store.addSource('src/a.ts:1', { name: 'x' });
  store.addSource('src/a.ts:1', { name: 'y' });   // same source → duplicate
  store.addSource('src/a.ts:2', { name: 'z' });   // different line → kept
  const before = store.exportRecords().length;
  const removed = store.dedupe();
  assert.equal(removed, 1);
  assert.equal(store.exportRecords().length, before - 1);
});

test('evidence redaction rewrites excerpt content', () => {
  const ev = store.addSource('src/a.ts:1', {});
  ev.excerpt = 'token = "sk_live_SUPERSECRETVALUE123"';
  store.redact((t) => t.replace(/sk_live_[A-Za-z0-9]+/, '[REDACTED]'));
  assert.match(store.get(ev.id).excerpt, /\[REDACTED\]/);
});

test('evidence integrity self-test detects stale records', () => {
  const ev = store.addSource('src/a.ts:2', {});
  let res = store.integritySelfTest();
  assert.equal(res.ok, true);
  writeFileSync(join(root, 'src', 'a.ts'), 'CHANGED\n');
  res = store.integritySelfTest();
  assert.equal(res.ok, false);
  assert.ok(res.broken.includes(ev.id));
});

test('evidence export/import roundtrip merges by id', () => {
  const ev = store.addSource('src/a.ts:1', { name: 'p1' });
  const exported = store.exportRecords();
  const other = new EvidenceStore(root, 'commit_1');
  const merged = other.importRecords(exported);
  assert.equal(merged, 1);
  assert.ok(other.get(ev.id));
});

// ── P2: Independent verification & refutation benchmark ─────────────────────

test('verification benchmark: observed accuracy + refutation (not derived)', async () => {
  const trueFindings = [{ id: 't1' }, { id: 't2' }];
  const falseFindings = [{ id: 'f1' }, { id: 'f2' }];
  const verify = async (f) => f.id.startsWith('t')
    ? { decision: 'verified', confidence: 0.9 }
    : { decision: 'refuted', confidence: 0.9 };

  const res = await runVerificationBenchmark({ trueFindings, falseFindings, verify, provider: 'mock', model: 'mock' });
  assert.equal(res.observed, true);
  assert.equal(res.metrics.verificationAccuracy, 1);
  assert.equal(res.metrics.refutationRate, 1);
  assert.equal(res.metrics.trueDetectionRate, 1);
  assert.equal(res.independence.provider, 'mock');
});

test('verification benchmark catches an over-accepting verifier (bad refutation)', async () => {
  const verify = async () => ({ decision: 'verified', confidence: 0.9 });
  const res = await runVerificationBenchmark({
    trueFindings: [{ id: 't1' }], falseFindings: [{ id: 'f1' }, { id: 'f2' }], verify,
  });
  assert.equal(res.metrics.acceptedFalse, 2);
  assert.equal(res.metrics.refutationRate, 0);
  assert.equal(res.metrics.verificationAccuracy, 0.333); // rounded to 3 decimals
});

// ── P7: TRUE mutation testing (real worktree + real test suite) ─────────────

let mutRoot;

beforeEach(() => {
  mutRoot = mkdtempSync(join(tmpdir(), 'arena-mut2-'));
  writeFileSync(join(mutRoot, 'package.json'), JSON.stringify({ name: 'calc', type: 'module' }));
  mkdirSync(join(mutRoot, 'src'), { recursive: true });
  writeFileSync(join(mutRoot, 'src', 'calc.js'), 'export function add(a, b) {\n  if (a > 0) return a + b;\n  return 0;\n}\n');
  mkdirSync(join(mutRoot, 'tests'), { recursive: true });
  writeFileSync(join(mutRoot, 'tests', 'calc.test.js'), [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { add } from "../src/calc.js";',
    'test("adds positives", () => { assert.equal(add(2, 3), 5); });',
    'test("zero", () => { assert.equal(add(-1, 3), 0); });',
  ].join('\n'));
  const g = (args) => spawnSync('git', args, { cwd: mutRoot, encoding: 'utf-8' });
  g(['init']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  g(['add', '.']); g(['commit', '-m', 'init']);
});

afterEach(() => { try { rmSync(mutRoot, { recursive: true, force: true }); } catch {} });

test('true mutation: KILLED when the real test suite fails, with dual scores', () => {
  const report = runTrueMutationTesting({
    root: mutRoot,
    files: [{ path: 'src/calc.js' }],
    limit: 4,
    testFiles: ['tests/calc.test.js'],
    timeoutMs: 60000,
  });

  assert.equal(report.available, true);
  assert.equal(report.runner, 'node-test');
  assert.ok(report.totalMutants >= 1);
  // The test suite asserts add(2,3)===5 and add(-1,3)===0 — most logic mutants die.
  assert.ok(
    report.metrics.testMutationScore >= 0.5,
    `test mutation score ${report.metrics.testMutationScore} — results: ${JSON.stringify(report.results.map((r) => ({ op: r.operator, cls: r.classification, test: r.testStatus })))}`
  );
  assert.ok(report.metrics.arenaDetectionScore !== null);
  assert.ok(report.results.every((r) => ['KILLED', 'SURVIVED', 'INVALID', 'TIMEOUT'].includes(r.classification)));
  // worktrees cleaned up
  const wt = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: mutRoot, encoding: 'utf-8' }).stdout;
  assert.equal(wt.trim().split('\n').filter((l) => l.startsWith('worktree ')).length, 1);
});

test('true mutation outside git reports unavailable honestly', () => {
  const plain = mkdtempSync(join(tmpdir(), 'arena-plain-'));
  const report = runTrueMutationTesting({ root: plain, files: [], limit: 1 });
  assert.equal(report.available, false);
  rmSync(plain, { recursive: true, force: true });
});

// ── P8: Snapshot sandbox ─────────────────────────────────────────────────────

test('snapshot workspace copies sources, skips node_modules and symlinks', () => {
  const src = mkdtempSync(join(tmpdir(), 'arena-snap-src-'));
  mkdirSync(join(src, 'app'), { recursive: true });
  writeFileSync(join(src, 'app', 'index.js'), 'export const x = 1;\n');
  mkdirSync(join(src, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(src, 'node_modules', 'dep', 'i.js'), 'huge');
  // symlink escape attempt (P8-15)
  try { spawnSync('cmd.exe', ['/c', 'mklink', '/D', join(src, 'escape'), 'C:\\Windows'], { stdio: 'ignore' }); } catch {}

  const snap = createSnapshotWorkspace(src);
  assert.equal(snap.fileCount, 1, 'only the source file must be copied');
  assert.ok(existsSync(join(snap.workspace, 'app', 'index.js')));
  assert.equal(existsSync(join(snap.workspace, 'escape')), false, 'symlinks must not be followed');
  snap.cleanup();
  assert.equal(existsSync(snap.workspace), false);
  rmSync(src, { recursive: true, force: true });
});

test('snapshot path containment rejects escapes', () => {
  const snap = createSnapshotWorkspace(mkdtempSync(join(tmpdir(), 'arena-snap2-')));
  assert.equal(assertPathInsideSnapshot(snap.workspace, 'src/a.ts'), true);
  assert.equal(assertPathInsideSnapshot(snap.workspace, '../../etc/passwd'), false);
  snap.cleanup();
});

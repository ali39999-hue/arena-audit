import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computePatchConfidence, diffScope } from '../../src/remediation/confidence.mjs';
import { loadRemediation, approvePatch, rejectPatch } from '../../src/remediation/approval.mjs';

// ── P13-07: confidence factors ───────────────────────────────────────────────

const GOOD_DIFF = [
  '--- a/src/auth/login.ts',
  '+++ b/src/auth/login.ts',
  '@@ -40,7 +40,7 @@',
  ' context line',
  '-const t = token()',
  '+const t = token({ expires: 3600 })',
  ' more context',
  ' even more',
  ' padding',
].join('\n');

const mkRecord = (over = {}) => ({
  id: 'p1', path: 'src/auth/login.ts:42', diff: GOOD_DIFF,
  validation: { appliesCleanly: true, testStatus: 'tests_passed', output: '' },
  ...over,
});

test('diffScope counts files and changed lines, excluding headers', () => {
  const s = diffScope(GOOD_DIFF);
  assert.deepEqual(s.files, ['src/auth/login.ts']);
  assert.equal(s.changedLines, 2);
});

test('a clean, tested, surgical, aligned patch scores full confidence', () => {
  const c = computePatchConfidence(mkRecord());
  assert.equal(c.confidence, 1);
  assert.equal(c.recommended, true);
  assert.ok(c.factors.every((f) => f.met));
});

test('failed tests drag confidence down and block recommendation', () => {
  const c = computePatchConfidence(mkRecord({ validation: { appliesCleanly: true, testStatus: 'tests_failed' } }));
  assert.equal(c.confidence, 0.7);
  assert.equal(c.recommended, false, 'failed tests must never be recommended');
});

test('no test runner ran = unverified factor, never recommended', () => {
  const c = computePatchConfidence(mkRecord({ validation: { appliesCleanly: true, testStatus: 'no_runner' } }));
  assert.equal(c.confidence, 0.7);
  assert.equal(c.recommended, false);
});

test('multi-file broad patches lose minimal_scope', () => {
  const broad = GOOD_DIFF + '\n--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n';
  const c = computePatchConfidence(mkRecord({ diff: broad }));
  const scopeFactor = c.factors.find((f) => f.key === 'minimal_scope');
  assert.equal(scopeFactor.met, false);
  assert.match(scopeFactor.detail, /2 file\(s\)/);
});

test('patch touching a different file than the evidence is not aligned', () => {
  const c = computePatchConfidence(mkRecord({ path: 'src/other/place.ts:10' }));
  const aligned = c.factors.find((f) => f.key === 'evidence_aligned');
  assert.equal(aligned.met, false);
});

// ── P13-08: approval workflow ────────────────────────────────────────────────

let outDir;

function seedApprovalFile(record) {
  outDir = mkdtempSync(join(tmpdir(), 'arena-appr-'));
  // Records always carry computed confidence in real runs:
  record.confidence = record.confidence || computePatchConfidence(record);
  writeFileSync(join(outDir, 'remediation.json'), JSON.stringify({ note: 'test', patches: [record] }, null, 2));
}

test('approve records who/when and persists (audit-style)', () => {
  seedApprovalFile(mkRecord({ id: 'patch_ok' }));
  const { patch } = approvePatch(outDir, 'patch_ok', { approver: 'ali' });
  assert.equal(patch.approval.status, 'approved');
  assert.equal(patch.approval.approver, 'ali');
  assert.ok(patch.approval.at);

  const persisted = JSON.parse(readFileSync(join(outDir, 'remediation.json'), 'utf-8'));
  assert.equal(persisted.patches[0].approval.status, 'approved');
  rmSync(outDir, { recursive: true, force: true });
});

test('approve below the bar is blocked until --force (P13-08 gate)', () => {
  seedApprovalFile(mkRecord({ id: 'patch_weak', validation: { appliesCleanly: true, testStatus: 'tests_failed' } }));
  const res = approvePatch(outDir, 'patch_weak', { approver: 'ali' });
  assert.equal(res.blocked, true);
  assert.match(res.warning, /--force/);
  const forced = approvePatch(outDir, 'patch_weak', { approver: 'ali', force: true });
  assert.equal(forced.patch.approval.forced, true);
  rmSync(outDir, { recursive: true, force: true });
});

test('reject records the reason; unknown ids error out', () => {
  seedApprovalFile(mkRecord({ id: 'patch_r' }));
  const patch = rejectPatch(outDir, 'patch_r', { reason: 'wrong approach', approver: 'ali' });
  assert.equal(patch.approval.status, 'rejected');
  assert.equal(patch.approval.reason, 'wrong approach');
  assert.throws(() => approvePatch(outDir, 'nope', {}), /unknown patch id/);
  rmSync(outDir, { recursive: true, force: true });
});

test('double approval is refused', () => {
  seedApprovalFile(mkRecord({ id: 'patch_d' }));
  approvePatch(outDir, 'patch_d', { approver: 'ali', force: true });
  assert.throws(() => approvePatch(outDir, 'patch_d', { approver: 'bob', force: true }), /already approved/);
  rmSync(outDir, { recursive: true, force: true });
});

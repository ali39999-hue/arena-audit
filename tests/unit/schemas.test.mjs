import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFinding, validateEvidence, validateAuditRun, createAuditRun,
  FINDING_STATUSES, ENGINE_SCHEMA_VERSION,
} from '../../src/core/schemas.mjs';

test('validateFinding accepts a well-formed finding', () => {
  const r = validateFinding({
    id: 'f1', lens: 'security', path: 'src/a.ts:10', problem: 'x', severity: 'high', status: 'verified', confidence: 0.9,
  });
  assert.equal(r.ok, true);
});

test('validateFinding rejects missing path and problem', () => {
  const r = validateFinding({ id: 'f2', lens: 'security' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('path')));
  assert.ok(r.errors.some((e) => e.includes('problem')));
});

test('validateFinding rejects bad severity and status', () => {
  const r = validateFinding({ id: 'f3', lens: 'l', path: 'a.ts:1', problem: 'p', severity: 'catastrophic', status: 'magical' });
  assert.equal(r.ok, false);
});

test('confidence must be within [0..1]', () => {
  const r = validateFinding({ id: 'f4', lens: 'l', path: 'a.ts:1', problem: 'p', confidence: 1.5 });
  assert.equal(r.ok, false);
});

test('validateEvidence: source evidence requires path/hash/excerpt', () => {
  const bad = validateEvidence({ id: 'e1', type: 'source' });
  assert.equal(bad.ok, false);
  const good = validateEvidence({ id: 'e2', type: 'source', path: 'a.ts', contentHash: 'h', excerpt: 'x' });
  assert.equal(good.ok, true);
  const cmd = validateEvidence({ id: 'e3', type: 'command', command: 'node --version' });
  assert.equal(cmd.ok, true);
});

test('createAuditRun satisfies its own contract', () => {
  const run = createAuditRun({ engineVersion: '2.0.0', mode: 'full' });
  assert.equal(validateAuditRun(run).ok, true);
  assert.equal(run.schemaVersion, ENGINE_SCHEMA_VERSION);
  assert.ok(run.runId.startsWith('run_'));
  assert.equal(run.status, 'running');
});

test('finding statuses include the v2 lifecycle states', () => {
  for (const s of ['candidate', 'verified', 'refuted', 'inconclusive', 'invalid', 'stale']) {
    assert.ok(FINDING_STATUSES.includes(s));
  }
});

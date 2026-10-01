import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDataset } from '../../src/evals/dataset.mjs';
import { runPipelineEval } from '../../src/evals/pipeline-eval.mjs';
import { JsonStore } from '../../src/server/store.mjs';
import { handleRequest } from '../../src/server/api.mjs';

// ── P10-02..04 core: pipeline eval with mock LLM (X-16) ─────────────────────

let root;
let dataset;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arena-pipe-'));
  dataset = generateDataset(root, { size: 24, seed: 11 });
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ }
});

test('perfect verifier: precision is exactly 1 — anchoring guarantees it', async () => {
  const r = await runPipelineEval(dataset, { seed: 5, verifierReliability: 1.0 });
  assert.equal(r.hallucinated > 0, true, 'mock must plant hallucinations to test elimination');
  assert.equal(r.hallucinationEliminated, r.hallucinated, 'every hallucination must be anchored out');
  assert.equal(r.precision, 1);
  assert.equal(r.recall, 1);
  assert.equal(r.verifiedFalsePositive, 0);
});

test('imperfect verifier: recall tracks the reliability ceiling, precision stays 1', async () => {
  const r = await runPipelineEval(dataset, { seed: 5, verifierReliability: 0.5 });
  assert.equal(r.precision, 1, 'precision floor holds regardless of verifier noise');
  assert.ok(Math.abs(r.recall - 0.5) <= 0.05, `recall ${r.recall} should match the 0.5 ceiling`);
  assert.ok(r.refuted > 0, 'true findings flipped by the unreliable verifier are labeled refuted, not dropped');
});

test('two seeds produce deterministic, repeatable metrics', async () => {
  const a = await runPipelineEval(dataset, { seed: 9, verifierReliability: 0.7 });
  const b = await runPipelineEval(dataset, { seed: 9, verifierReliability: 0.7 });
  assert.equal(a.recall, b.recall);
  assert.equal(a.hallucinationEliminated, b.hallucinationEliminated);
});

// ── P16-lite: RBAC tokens + audit log ────────────────────────────────────────

let store;
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arena-rbac-'));
  store = new JsonStore(join(dir, 'cp.json'));
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

const req = (store, { method, url, body, bearer }, opts) =>
  handleRequest(store, { method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, body }, opts);

test('bootstrap admin can mint role tokens; raw secret is shown exactly once', () => {
  const created = req(store, { method: 'POST', url: '/api/tokens', body: { name: 'tri', role: 'triager' }, bearer: 'boot' }, { token: 'boot' });
  assert.equal(created.status, 201);
  assert.match(created.body.raw, /^arena_/);
  const listed = req(store, { method: 'GET', url: '/api/tokens', bearer: 'boot' }, { token: 'boot' });
  assert.equal(listed.body[0].raw, undefined, 'raw token must never appear in listings');
});

test('role enforcement: viewer cannot resolve, triager can, bad role rejected', () => {
  req(store, { method: 'POST', url: '/api/ingest', body: { project: { name: 'd' }, audit: mkAuditForRbac() }, bearer: 'boot' }, { token: 'boot' });
  const viewer = req(store, { method: 'POST', url: '/api/tokens', body: { name: 'v', role: 'viewer' }, bearer: 'boot' }, { token: 'boot' });
  const triager = req(store, { method: 'POST', url: '/api/tokens', body: { name: 't', role: 'triager' }, bearer: 'boot' }, { token: 'boot' });

  const deny = req(store, { method: 'POST', url: `/api/findings/fp-1/resolve`, body: { resolution: 'fixed' }, bearer: viewer.body.raw }, { token: 'boot' });
  assert.equal(deny.status, 403, 'viewer must not resolve findings');

  const allow = req(store, { method: 'POST', url: `/api/findings/fp-1/resolve`, body: { resolution: 'fixed' }, bearer: triager.body.raw }, { token: 'boot' });
  assert.equal(allow.status, 200);

  const badRole = req(store, { method: 'POST', url: '/api/tokens', body: { name: 'x', role: 'superuser' }, bearer: 'boot' }, { token: 'boot' });
  assert.equal(badRole.status, 400);
});

test('audit log records actor+action+target, admin-only to read', () => {
  req(store, { method: 'POST', url: '/api/ingest', body: { project: { name: 'd' }, audit: mkAuditForRbac() }, bearer: 'boot' }, { token: 'boot' });
  const triager = req(store, { method: 'POST', url: '/api/tokens', body: { name: 't', role: 'triager' }, bearer: 'boot' }, { token: 'boot' });
  req(store, { method: 'POST', url: '/api/findings/fp-1/resolve', body: { resolution: 'fixed' }, bearer: triager.body.raw }, { token: 'boot' });

  const denied = req(store, { method: 'GET', url: '/api/auditlog', bearer: triager.body.raw }, { token: 'boot' });
  assert.equal(denied.status, 403);

  const log = req(store, { method: 'GET', url: '/api/auditlog', bearer: 'boot' }, { token: 'boot' });
  assert.equal(log.status, 200);
  const actions = log.body.map((e) => e.action);
  assert.ok(actions.includes('ingest'));
  assert.ok(actions.includes('resolve:fixed'));
  assert.ok(log.body.every((e) => e.actor && e.at));
});

test('revoked token loses access', () => {
  const created = req(store, { method: 'POST', url: '/api/tokens', body: { name: 't', role: 'triager' }, bearer: 'boot' }, { token: 'boot' });
  req(store, { method: 'DELETE', url: `/api/tokens/${created.body.id}`, bearer: 'boot' }, { token: 'boot' });
  const after = req(store, { method: 'POST', url: '/api/projects', body: { name: 'x' }, bearer: created.body.raw }, { token: 'boot' });
  assert.equal(after.status, 401);
});

function mkAuditForRbac() {
  return {
    run: { runId: 'run_rbac1', repository: 'd', commit: 'c', mode: 'full', engineVersion: '2.6.0', status: 'completed', startedAt: new Date().toISOString(), engine: {} },
    gates: [],
    scores: { overall: 50, coverage: { percent: 100 } },
    findings: [
      { id: 'f1', fingerprint: 'fp-1', lens: 'security', path: 'a.ts:1', problem: 'p', severity: 'high', status: 'verified', confidence: 0.9 },
    ],
  };
}

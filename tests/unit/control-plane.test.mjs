import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../../src/server/store.mjs';
import { handleRequest, createControlPlane } from '../../src/server/api.mjs';

// ── Pure handler tests (no sockets) ──────────────────────────────────────────

let store;
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arena-cp-'));
  store = new JsonStore(join(dir, 'cp.json'));
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

const mkAudit = () => ({
  run: {
    runId: 'run_test1', repository: 'demo', commit: 'abc123', mode: 'full',
    engineVersion: '2.3.0', status: 'completed', startedAt: new Date().toISOString(),
    engine: { provider: 'openai', model: 'gpt-4o' },
  },
  gates: [{ id: 'typecheck', status: 'pass', durationMs: 100 }],
  scores: { overall: 88, coverage: { percent: 100 } },
  findings: [
    { id: 'f1', fingerprint: 'fp-1', lens: 'security', path: 'src/a.ts:1', problem: 'issue one', severity: 'high', status: 'verified', confidence: 0.9, baselineState: 'new' },
    { id: 'f2', fingerprint: 'fp-2', lens: 'correctness', path: 'src/b.ts:2', problem: 'issue two', severity: 'low', status: 'verified', confidence: 0.8, baselineState: 'known' },
  ],
});

test('ingest → project/run/findings roundtrip (idempotent by runId)', () => {
  const r1 = handleRequest(store, { method: 'POST', url: '/api/ingest', body: { project: { name: 'demo' }, audit: mkAudit() } });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.findingsIngested, 2);
  const r2 = handleRequest(store, { method: 'POST', url: '/api/ingest', body: { project: { name: 'demo' }, audit: mkAudit() } });
  assert.equal(r2.body.created, false, 'duplicate run must not double-ingest');
  const runs = handleRequest(store, { method: 'GET', url: '/api/projects/' + r1.body.projectId + '/runs' });
  assert.equal(runs.body.length, 1);
});

test('findings query filters by status/severity/baselineState', () => {
  handleRequest(store, { method: 'POST', url: '/api/ingest', body: { project: { name: 'demo' }, audit: mkAudit() } });
  const highs = handleRequest(store, { method: 'GET', url: '/api/findings?severity=high' });
  assert.equal(highs.body.length, 1);
  const known = handleRequest(store, { method: 'GET', url: '/api/findings?baselineState=known' });
  assert.equal(known.body.length, 1);
  assert.equal(known.body[0].fingerprint, 'fp-2');
});

test('resolve transitions finding lifecycle (P15-06)', () => {
  handleRequest(store, { method: 'POST', url: '/api/ingest', body: { project: { name: 'demo' }, audit: mkAudit() } });
  const bad = handleRequest(store, { method: 'POST', url: '/api/findings/fp-1/resolve', body: { resolution: 'magic' } });
  assert.equal(bad.status, 400);
  const ok = handleRequest(store, { method: 'POST', url: '/api/findings/fp-1/resolve', body: { resolution: 'accepted_risk', note: 'ops approved' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'accepted_risk');
  assert.equal(ok.body.resolution.note, 'ops approved');
});

test('trends returns chronological score history (P15-07)', () => {
  const ing = handleRequest(store, { method: 'POST', url: '/api/ingest', body: { project: { name: 'demo' }, audit: mkAudit() } });
  const trends = handleRequest(store, { method: 'GET', url: '/api/projects/' + ing.body.projectId + '/trends' });
  assert.equal(trends.body.length, 1);
  assert.equal(trends.body[0].overall, 88);
  assert.equal(trends.body[0].new, 1);
});

test('auth: with token set, missing/wrong bearer is 401; health stays open', () => {
  const audit = mkAudit();
  const opts = { token: 'sekrit' };
  const health = handleRequest(store, { method: 'GET', url: '/api/health', headers: {} }, opts);
  assert.equal(health.status, 200);
  const denied = handleRequest(store, { method: 'GET', url: '/api/projects', headers: {} }, opts);
  assert.equal(denied.status, 401);
  const allowed = handleRequest(store, { method: 'GET', url: '/api/projects', headers: { authorization: 'Bearer sekrit' } }, opts);
  assert.equal(allowed.status, 200);
});

// ── HTTP server integration (ephemeral port) ─────────────────────────────────

test('control plane serves dashboard + API over real HTTP, then shuts down', async () => {
  const server = await createControlPlane(store, { port: 0, token: 'sekrit', dashboard: '<h1>arena-cp-test</h1>' });
  const { port } = server.address();
  const authed = { 'Content-Type': 'application/json', authorization: 'Bearer sekrit' };

  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(await page.text(), /arena-cp-test/);

  // Anonymous mutation with token-protected server → 401
  const anon = await fetch(`http://127.0.0.1:${port}/api/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: { name: 'demo' }, audit: mkAudit() }),
  });
  assert.equal(anon.status, 401);

  const ing = await fetch(`http://127.0.0.1:${port}/api/ingest`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({ project: { name: 'demo' }, audit: mkAudit() }),
  });
  assert.equal(ing.status, 201);

  const list = await fetch(`http://127.0.0.1:${port}/api/findings?severity=high`, { headers: authed });
  const listBody = await list.json();
  assert.equal(listBody.length, 1);

  // Release keep-alive connections BEFORE closing, then close once.
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

test('server refuses public bind without token (honest security boundary)', async () => {
  const mod = await import('../../src/server/api.mjs');
  assert.throws(
    () => mod.createControlPlane(store, { host: '0.0.0.0', port: 0, token: null }),
    /Refusing to bind/,
  );
});

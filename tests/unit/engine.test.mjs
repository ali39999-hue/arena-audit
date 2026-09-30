import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPool, withTimeout } from '../../src/core/concurrency.mjs';
import { dedupeFindings, fingerprint, computeScores } from '../../src/findings/findings.mjs';
import { normalizeGateResult } from '../../src/gates/registry.mjs';

// ── Concurrency (P5-05) ──────────────────────────────────────────────────────

test('runPool preserves order and runs bounded', async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const results = await runPool(items, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return n * 2;
  }, { maxConcurrency: 4 });
  assert.equal(peak <= 4, true, `peak concurrency ${peak} exceeded limit 4`);
  assert.deepEqual(results.map((r) => r.value), items.map((n) => n * 2));
  assert.ok(results.every((r) => r.ok));
});

test('runPool isolates failures: one bad item does not kill the audit', async () => {
  const items = [1, 2, 3, 4];
  const results = await runPool(items, async (n) => {
    if (n === 2) throw new Error('boom');
    return n;
  }, { maxConcurrency: 2 });
  assert.equal(results[1].ok, false);
  assert.equal(results[0].value, 1);
  assert.equal(results[3].value, 4);
});

test('withTimeout rejects on timeout', async () => {
  await assert.rejects(
    withTimeout(() => new Promise((r) => setTimeout(r, 500)), 50, 'slow'),
    /timed out/,
  );
});

// ── Finding Intelligence (P7) ────────────────────────────────────────────────

test('fingerprint is stable and location-sensitive', () => {
  const a = { lens: 'security', path: 'src/auth.ts:42', problem: 'hardcoded secret in source' };
  const b = { lens: 'Security', path: 'src/auth.ts:99', problem: 'hardcoded secret in source' }; // same issue, other line/lens case
  const c = { lens: 'security', path: 'src/other.ts:42', problem: 'hardcoded secret in source' };
  assert.equal(fingerprint(a), fingerprint(b)); // lens case-insensitive, line-insensitive
  assert.notEqual(fingerprint(a), fingerprint(c));
});

test('dedupeFindings merges duplicates and keeps worst severity / lowest confidence', () => {
  const merged = dedupeFindings([
    { lens: 'security', path: 'src/a.ts:1', problem: 'sql injection risk in query builder', severity: 'high', confidence: 0.9 },
    { lens: 'correctness', path: 'src/a.ts:1', problem: 'sql injection risk in query builder', severity: 'medium', confidence: 0.6 },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].severity, 'high');
  assert.equal(merged[0].confidence, 0.6);
  assert.ok(merged[0].sources.includes('security'));
  assert.ok(merged[0].sources.includes('correctness'));
});

// ── Scoring 2.0 (P8): NOT CHECKED ≠ PASS ─────────────────────────────────────

const gate = (id, status) => normalizeGateResult({ id, status });

test('no gates ran → overall is null (unknown), never 100', () => {
  const s = computeScores([gate('typecheck', 'not_available'), gate('lint', 'not_available')], []);
  assert.equal(s.overall, null);
  assert.equal(s.domains.integrity.score, null);
  assert.equal(s.coverage.percent, 0);
});

test('passed gates yield 100 integrity only when evidence exists', () => {
  const s = computeScores([gate('typecheck', 'pass'), gate('lint', 'pass')], []);
  assert.equal(s.domains.integrity.score, 100);
  assert.equal(s.overall, 100);
  assert.equal(s.coverage.percent, 100);
});

test('verified findings deduct with confidence weighting; refuted do not', () => {
  const gates = [gate('typecheck', 'pass')];
  const findings = [
    { lens: 'security', path: 'a.ts:1', problem: 'x', severity: 'high', status: 'verified', confidence: 1.0 },
    { lens: 'security', path: 'b.ts:2', problem: 'y', severity: 'high', status: 'refuted', confidence: 0.9 },
  ];
  const s = computeScores(gates, findings);
  assert.equal(s.domains.security.score, 88); // 100 - 12*1.0
  assert.equal(s.coverage.verifiedFindings, 1);
  assert.equal(s.coverage.refutedFindings, 1);
});

test('failed gates reduce integrity and are surfaced in gateStatuses', () => {
  const s = computeScores([gate('typecheck', 'fail'), gate('lint', 'pass'), gate('test', 'not_available')], []);
  assert.equal(s.domains.integrity.score, 50);
  assert.equal(s.gateStatuses.test, 'not_available');
  assert.deepEqual(s.failedGates, ['typecheck']);
});

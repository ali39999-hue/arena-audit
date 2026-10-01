import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBaseline, saveBaseline, loadBaseline, classifyAgainstBaseline, detectRegressions } from '../../src/findings/baseline.mjs';
import { decideConclusion, buildCheckPayload, buildPrComment, prNumberFromEnv, COMMENT_MARKER } from '../../src/integrations/github.mjs';
import { createTelemetry } from '../../src/observability/telemetry.mjs';
import { normalizeGateResult } from '../../src/gates/registry.mjs';

// ── P14: Baseline / regression ───────────────────────────────────────────────

const mkFinding = (over = {}) => ({
  lens: 'security', path: 'src/a.ts:1', problem: 'hardcoded value risk in config',
  severity: 'high', status: 'verified', confidence: 0.9, fingerprint: 'fp-a', ...over,
});

test('baseline roundtrip: save → load → classify new vs known vs fixed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-bl-'));
  const baseline = buildBaseline({
    findings: [mkFinding(), mkFinding({ fingerprint: 'fp-b', path: 'src/b.ts:2', problem: 'off by one in loop counter' })],
    runId: 'run_x', scope: 'full', commit: 'abc',
  });
  const path = saveBaseline(join(dir, 'arena-baseline.json'), baseline);
  const loaded = loadBaseline(path);
  assert.equal(loaded.runId, 'run_x');

  // Current run: fp-a still present (known), fp-c new, fp-b gone (fixed).
  const findings = [
    mkFinding(), // fp-a → known
    mkFinding({ fingerprint: 'fp-c', path: 'src/c.ts:3', problem: 'brand new issue in parser' }), // new
  ];
  const cls = classifyAgainstBaseline(findings, loaded);
  assert.deepEqual(cls.known, ['fp-a']);
  assert.deepEqual(cls.new, ['fp-c']);
  assert.deepEqual(cls.fixed, ['fp-b']);
  // Findings are labeled in place:
  assert.equal(findings[0].baselineState, 'known');
  assert.equal(findings[1].baselineState, 'new');
  rmSync(dir, { recursive: true, force: true });
});

test('corrupt baseline is reported, never guessed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-bl2-'));
  const p = join(dir, 'bad.json');
  writeFileSync(p, '{"hello":true}');
  const loaded = loadBaseline(p);
  assert.equal(loaded.corrupt, true);
  rmSync(dir, { recursive: true, force: true });
});

test('regression detector flags fixed fingerprints that reappear', () => {
  const regressions = detectRegressions(
    [mkFinding({ fingerprint: 'fp-b' })],
    [{ fingerprint: 'fp-b', fixedAtRunId: 'run_prev' }],
  );
  assert.equal(regressions.length, 1);
});

// ── P12: GitHub payloads (pure) ──────────────────────────────────────────────

const gates = (statuses) => statuses.map((s) => normalizeGateResult({ id: s, status: s === 'pass' ? 'pass' : 'fail' }));

test('conclusion policy: failure only for failing gates or NEW verified high', () => {
  const pass = [normalizeGateResult({ id: 'typecheck', status: 'pass' })];
  const knownHigh = [mkFinding({ baselineState: 'known' })];
  const newHigh = [mkFinding({ baselineState: 'new' })];
  const newMed = [mkFinding({ severity: 'medium', baselineState: 'new' })];

  assert.equal(decideConclusion({ gates: gates(['fail']), findings: [] }), 'failure');
  assert.equal(decideConclusion({ gates: pass, findings: newHigh }), 'failure');
  assert.equal(decideConclusion({ gates: pass, findings: knownHigh }), 'success', 'known debt must not block');
  assert.equal(decideConclusion({ gates: pass, findings: newMed }), 'success');
  assert.equal(decideConclusion({ gates: [], findings: [], coverage: { percent: 0 } }), 'neutral');
});

test('check payload carries conclusion, score and gate summary', () => {
  const payload = buildCheckPayload({
    conclusion: 'failure', scores: { overall: 62 },
    newVerified: 2, knownVerified: 5,
    gates: gates(['pass', 'fail']),
    runMeta: { commit: 'deadbeef' },
  });
  assert.equal(payload.conclusion, 'failure');
  assert.equal(payload.head_sha, 'deadbeef');
  assert.match(payload.output.summary, /62/);
  assert.match(payload.output.summary, /2 new/);
});

test('PR comment is idempotent (marker) and lists new findings', () => {
  const body = buildPrComment({
    runMeta: { runId: 'run_x', mode: 'diff' },
    scores: { overall: 90 }, coverage: { percent: 100 },
    gates: [normalizeGateResult({ id: 'typecheck', status: 'pass' })],
    newFindings: [mkFinding({ fingerprint: 'fp-new1' })],
    knownCount: 3, fixedCount: 1, priorities: [],
  });
  assert.ok(body.includes(COMMENT_MARKER));
  assert.match(body, /fp-new1/);
  assert.match(body, /\| 1 \| 3 \| 1 \|/);
});

test('pr number extracted from Actions ref', () => {
  assert.equal(prNumberFromEnv({ GITHUB_REF: 'refs/pull/42/merge' }), 42);
  assert.equal(prNumberFromEnv({ GITHUB_REF: 'refs/heads/main' }), null);
  assert.equal(prNumberFromEnv({ GITHUB_PR_NUMBER: '7' }), 7);
});

// ── P19: Telemetry ───────────────────────────────────────────────────────────

test('telemetry: spans record durations, summary aggregates, errors counted', async () => {
  const t = createTelemetry('run_t1');
  const span = t.start('gate', 'typecheck');
  await new Promise((r) => setTimeout(r, 15));
  span.end('ok', { status: 'pass' });

  const s2 = t.start('llm', 'provider-call');
  s2.end('error', { message: 'rate limited' });
  t.error('fatal', 'boom');

  const sum = t.summary();
  assert.equal(sum.traceId, 'run_t1');
  assert.equal(sum.gateSpans, 1);
  assert.equal(sum.llmCalls, 1);
  assert.equal(sum.errorCount, 1);
  assert.ok(sum.byKind.gate.totalMs >= 10);
  assert.match(sum.costNote, /not reported/);

  const json = t.toJSON();
  assert.equal(json.traceId, 'run_t1');
  assert.ok(json.events.every((e) => e.traceId === 'run_t1' && e.spanId));
});

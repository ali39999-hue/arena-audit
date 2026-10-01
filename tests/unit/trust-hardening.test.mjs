import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enforceTrustInvariants, auditTrustDimensions } from '../../src/core/trust-gate.mjs';
import { EvidenceStore } from '../../src/evidence/evidence-store.mjs';

let root;
let store;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arena-trust-'));
  writeFileSync(join(root, 'service.ts'), 'export function safeService() {\n  return 42;\n}\n');
  store = new EvidenceStore(root, 'commit_abc123');
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
});

test('finding lacking evidenceRef is demoted from verified to inconclusive', () => {
  const findings = [
    { id: 'f1', status: 'verified', path: 'service.ts:2', problem: 'Unsubstantiated claim' },
  ];

  const report = enforceTrustInvariants({ root, findings, evidenceStore: store, commit: 'commit_abc123' });
  assert.equal(report.verifiedRemaining, 0);
  assert.equal(report.demotedCount, 1);
  assert.equal(findings[0].status, 'inconclusive');
  assert.equal(findings[0].trustViolation, 'Missing evidence reference');
});

test('finding with dangling evidenceRef is demoted to invalid', () => {
  const findings = [
    { id: 'f2', status: 'verified', evidenceRefs: ['ev_nonexistent'], path: 'service.ts:2', problem: 'Ghost proof' },
  ];

  const report = enforceTrustInvariants({ root, findings, evidenceStore: store, commit: 'commit_abc123' });
  assert.equal(report.verifiedRemaining, 0);
  assert.equal(findings[0].status, 'invalid');
});

test('finding with commit mismatch is demoted to stale', () => {
  const ev = store.addSource('service.ts:2', { kind: 'agent', name: 'verifier' });
  // Evidence is bound to commit_abc123
  const findings = [
    { id: 'f3', status: 'verified', evidenceRefs: [ev.id], verifierNote: 'verified on old commit', path: 'service.ts:2', problem: 'Old commit issue' },
  ];

  // Audited against new commit commit_xyz999
  const report = enforceTrustInvariants({ root, findings, evidenceStore: store, commit: 'commit_xyz999' });
  assert.equal(report.verifiedRemaining, 0);
  assert.equal(findings[0].status, 'stale');
  assert.match(findings[0].trustViolation, /commit mismatch/);
});

test('finding whose file content changed on disk is demoted to stale', () => {
  const ev = store.addSource('service.ts:2', { kind: 'agent', name: 'verifier' });
  const findings = [
    { id: 'f4', status: 'verified', evidenceRefs: [ev.id], verifierNote: 'confirmed', path: 'service.ts:2', problem: 'Altered file' },
  ];

  // Modify file content on disk to invalidate hash
  writeFileSync(join(root, 'service.ts'), 'export function safeService() {\n  // content changed entirely\n  return 100;\n}\n');

  const report = enforceTrustInvariants({ root, findings, evidenceStore: store, commit: 'commit_abc123' });
  assert.equal(report.verifiedRemaining, 0);
  assert.equal(findings[0].status, 'stale');
  assert.match(findings[0].trustViolation, /content hash does not match/);
});

test('finding missing verifier provenance is demoted to inconclusive', () => {
  // Add raw evidence with matching hash but no provenance and no verifierNote
  const content = 'export function safeService() {\n  return 42;\n}';
  const ev = store.addSource('service.ts:1-2', null); // no provenance
  delete ev.provenance;

  const findings = [
    { id: 'f5', status: 'verified', evidenceRefs: [ev.id], path: 'service.ts:1', problem: 'Mystery assertion' },
  ];

  const report = enforceTrustInvariants({ root, findings, evidenceStore: store, commit: 'commit_abc123' });
  assert.equal(report.verifiedRemaining, 0);
  assert.equal(findings[0].status, 'inconclusive');
  assert.match(findings[0].trustViolation, /Missing verifier provenance/);
});

test('legitimate verified finding with valid hash, commit, and provenance remains verified', () => {
  const ev = store.addSource('service.ts:2', { kind: 'agent', name: 'verifier' });
  const findings = [
    { id: 'f6', status: 'verified', evidenceRefs: [ev.id], verifierNote: 'Re-read line 2 and confirmed issue', path: 'service.ts:2', problem: 'Legit' },
  ];

  const report = enforceTrustInvariants({ root, findings, evidenceStore: store, commit: 'commit_abc123' });
  assert.equal(report.verifiedRemaining, 1);
  assert.equal(report.demotedCount, 0);
  assert.equal(findings[0].status, 'verified');
});

test('auditTrustDimensions audits all 10 trust dimensions', () => {
  const report = auditTrustDimensions({
    sandboxMode: 'trusted',
    env: { PATH: '/usr/bin' },
    hasGit: true,
    isDirty: false,
    evidenceStore: store,
  });

  assert.equal(report.allPassed, true);
  assert.ok(report.dimensions.commitBinding);
  assert.ok(report.dimensions.staleDetection);
  assert.ok(report.dimensions.verifierProvenance);
  assert.ok(report.dimensions.reproductionTracking);
  assert.ok(report.dimensions.sandboxIsolation);
  assert.ok(report.dimensions.environmentAllowlist);
  assert.ok(report.dimensions.filesystemIsolation);
  assert.ok(report.dimensions.providerIndependence);
  assert.ok(report.dimensions.toolPermissions);
  assert.ok(report.dimensions.auditReproducibility);
});

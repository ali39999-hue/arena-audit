/**
 * Arena Audit — Baseline / Regression Intelligence (P14-01..P14-04, P7-04)
 *
 * A baseline is the set of accepted finding fingerprints from a previous run.
 * The next audit classifies every finding as:
 *   new   — not in the baseline (this is what CI should gate on)
 *   known — already in the baseline (accepted risk / pre-existing debt)
 * and reports `fixed`: fingerprints present in the baseline that no longer
 * appear (regression detection happens when a `fixed` fingerprint reappears
 * later — P14-02).
 *
 * Scope honesty: comparison is fingerprint-based; if the audited scope
 * changed (full vs diff), the fixed-list is an underestimate. The record
 * stores the scope so consumers can check comparability.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fingerprint as computeFingerprint } from './findings.mjs';

export const BASELINE_SCHEMA_VERSION = 1;

/** Build a baseline record from current findings (verified + inconclusive only). */
export function buildBaseline({ findings, runId, scope = 'full', commit = null }) {
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    runId,
    scope,
    commit,
    createdAt: new Date().toISOString(),
    fingerprints: findings
      .filter((f) => f.status === 'verified' || f.status === 'inconclusive')
      .map((f) => ({
        fingerprint: f.fingerprint || computeFingerprint(f),
        path: f.path,
        severity: f.severity,
        status: f.status,
      })),
  };
}

export function saveBaseline(path, baseline) {
  writeFileSync(path, JSON.stringify(baseline, null, 2), 'utf-8');
  return path;
}

export function loadBaseline(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed?.schemaVersion !== BASELINE_SCHEMA_VERSION || !Array.isArray(parsed.fingerprints)) {
      return { corrupt: true, reason: 'unrecognized baseline schema' };
    }
    return parsed;
  } catch (e) {
    return { corrupt: true, reason: e.message };
  }
}

/**
 * Classify current findings against a baseline.
 * Mutates nothing: returns { new: [], known: [], fixed: [] } (fingerprints).
 */
export function classifyAgainstBaseline(findings, baseline) {
  const base = new Map();
  for (const b of baseline?.fingerprints || []) base.set(b.fingerprint, b);

  const out = { new: [], known: [], fixed: [] };
  const seen = new Set();
  for (const f of findings) {
    const fp = f.fingerprint || computeFingerprint(f);
    f.fingerprint = fp;
    seen.add(fp);
    if (base.has(fp)) {
      f.baselineState = 'known';
      out.known.push(fp);
    } else {
      f.baselineState = 'new';
      out.new.push(fp);
    }
  }
  for (const fp of base.keys()) {
    if (!seen.has(fp)) out.fixed.push(fp);
  }
  return out;
}

/**
 * P14-02 — Regression detector: a fingerprint that was FIXED in a previous
 * baseline and is present again in the current findings is a regression.
 * fixedHistory: [{fingerprint, fixedAtRunId}]
 */
export function detectRegressions(findings, fixedHistory = []) {
  const current = new Set(findings.map((f) => f.fingerprint || computeFingerprint(f)));
  return fixedHistory.filter((h) => current.has(h.fingerprint));
}

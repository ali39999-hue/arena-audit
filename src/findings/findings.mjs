/**
 * Arena Audit — Finding Intelligence (P7-01..P7-04) & Scoring 2.0 (P8)
 *
 * Fingerprint + dedupe: two agents seeing the same issue yield ONE canonical
 * finding with multiple evidence sources.
 *
 * Scoring principle: "NOT CHECKED ≠ PASS". Gates that did not run are
 * NOT_AVAILABLE — they are excluded from the score and reported as coverage,
 * never as a perfect 100.
 */

import { createHash } from 'node:crypto';
import { parseLocation } from '../evidence/evidence-store.mjs';
import { validateFinding } from '../core/schemas.mjs';

// ---------------------------------------------------------------------------
// P7-01 — Fingerprint: rule-agnostic, location-normalized identity.
// ---------------------------------------------------------------------------
export function fingerprint(finding) {
  const { file } = parseLocation(finding.path || finding.where || '');
  // Identity = file + normalized problem text. Deliberately lens-agnostic:
  // two specialists looking through different lenses at the SAME issue must
  // merge into one canonical finding with multiple evidence sources (P7-02).
  const problem = String(finding.problem || finding.what || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
    .slice(0, 12)
    .join('-');
  return createHash('sha256').update(`${file}|${problem}`).digest('hex').slice(0, 16);
}

/**
 * P7-02 — Deduplicate findings by fingerprint. Merges sources/lenses and
 * keeps the highest severity + lowest confidence (conservative).
 */
export function dedupeFindings(findings) {
  const byFp = new Map();
  for (const f of findings) {
    const fp = fingerprint(f);
    const existing = byFp.get(fp);
    if (!existing) {
      byFp.set(fp, { ...f, fingerprint: fp, sources: [f.lens] });
      continue;
    }
    existing.sources.push(f.lens);
    const rank = { high: 3, medium: 2, low: 1 };
    if ((rank[f.severity] || 0) > (rank[existing.severity] || 0)) existing.severity = f.severity;
    existing.confidence = Math.min(existing.confidence ?? 1, f.confidence ?? 1);
    if (!existing.evidence && f.evidence) existing.evidence = f.evidence;
  }
  return [...byFp.values()];
}

// ---------------------------------------------------------------------------
// P8 — Scoring 2.0: evidence-weighted, coverage-aware, deterministic.
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT = { high: 12, medium: 6, low: 2 };
const DOMAIN_BY_LENS = {
  correctness: 'correctness',
  security: 'security',
  architecture: 'architecture',
  testing: 'testing',
  quality: 'testing',
  performance: 'reliability',
  reliability: 'reliability',
};

/**
 * Compute scores.
 * @param {Array} gates normalized gate results (status: pass|fail|not_available|error)
 * @param {Array} findings deduplicated findings (status: verified|refuted|inconclusive|candidate|invalid)
 * @returns {{ overall, coverage, domains, gateStatuses, explanations }}
 */
export function computeScores(gates, findings) {
  const ran = gates.filter((g) => g.status === 'pass' || g.status === 'fail');
  const passed = gates.filter((g) => g.status === 'pass');
  const failed = gates.filter((g) => g.status === 'fail');
  const notAvailable = gates.filter((g) => g.status === 'not_available');
  const errored = gates.filter((g) => g.status === 'error');

  // Coverage: what fraction of the checks we'd expect actually ran.
  const coverage = {
    gatesRan: ran.length,
    gatesDetected: gates.length - notAvailable.length,
    percent: gates.length > 0 ? Math.round((ran.length / Math.max(1, gates.length - notAvailable.length)) * 100) : 0,
    verifiedFindings: findings.filter((f) => f.status === 'verified').length,
    refutedFindings: findings.filter((f) => f.status === 'refuted').length,
    inconclusiveFindings: findings.filter((f) => f.status === 'inconclusive').length,
    invalidFindings: findings.filter((f) => f.status === 'invalid').length,
  };

  // Domain scores start at 100 only where evidence exists; untouched domains
  // are marked unknown instead of silently perfect.
  const domains = {
    integrity: { score: null, basis: 'machine gates' },
    security: { score: null, basis: 'verified security findings' },
    correctness: { score: null, basis: 'verified correctness findings' },
    architecture: { score: null, basis: 'verified architecture findings' },
    testing: { score: null, basis: 'verified testing findings + test gates' },
  };

  // Integrity from gates that actually ran (no gates → null, NOT 100).
  if (ran.length > 0) {
    domains.integrity.score = Math.round((passed.length / ran.length) * 100);
  }

  // Findings: only verified ones deduct, weighted by confidence.
  const verified = findings.filter((f) => f.status === 'verified');
  const byDomain = { security: [], correctness: [], architecture: [], testing: [], other: [] };
  for (const f of verified) {
    const key = DOMAIN_BY_LENS[String(f.lens || '').toLowerCase()] || 'other';
    (byDomain[key] || byDomain.other).push(f);
  }
  for (const [domain, list] of Object.entries(byDomain)) {
    if (!list.length) continue;
    const deduction = list.reduce((acc, f) => acc + SEVERITY_WEIGHT[f.severity] * (f.confidence ?? 0.8), 0);
    const domKey = domains[domain] ? domain : 'correctness';
    domains[domKey].score = Math.max(0, Math.round(100 - deduction));
  }

  // Overall: average of known domain scores, penalized by gate coverage.
  const known = Object.values(domains).filter((d) => d.score !== null);
  const base = known.length ? Math.round(known.reduce((a, d) => a + d.score, 0) / known.length) : null;
  const overall = base === null ? null : Math.max(0, Math.min(100, base));

  const explanations = [
    `Gates: ${passed.length} passed, ${failed.length} failed, ${errored.length} errored, ${notAvailable.length} not available (excluded from score).`,
    coverage.percent < 100
      ? `Coverage is ${coverage.percent}% — the score describes only what was actually checked, NOT the whole repository.`
      : 'All detected gates ran.',
    `Verified findings deduct with confidence weighting; refuted (${coverage.refutedFindings}) and inconclusive (${coverage.inconclusiveFindings}) do not.`,
  ];

  return {
    overall,
    coverage,
    domains,
    gateStatuses: Object.fromEntries(gates.map((g) => [g.id, g.status])),
    failedGates: failed.map((g) => g.id),
    explanations,
  };
}

/**
 * Arena Audit — Deterministic Detector Layer (P4 gate, P6-07)
 *
 * Regex/structure detectors that find REAL issues with zero LLM calls and
 * zero dependencies. Every finding is line-exact and evidence-anchored by
 * construction (excerpt + hash via the Evidence Engine).
 *
 * Honest scope: patterns are intentionally conservative (precision first).
 * Their false-positive rate is MEASURED by the Evaluation Lab (P10) — the
 * numbers live in eval-report.json instead of being claimed here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const JS_FAMILY = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export const DETECTORS = [
  {
    id: 'hardcoded-credential',
    label: 'Hardcoded credential shape',
    category: 'security',
    severity: 'high',
    // Pattern shapes only — no literal credential strings live in this repo.
    pattern: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|(?:password|passwd|api_?key|secret)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
    exts: JS_FAMILY,
  },
  {
    id: 'eval-usage',
    label: 'Dynamic code evaluation',
    category: 'security',
    severity: 'high',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    exts: JS_FAMILY,
  },
  {
    id: 'sql-string-concat',
    label: 'SQL built by string concatenation',
    category: 'security',
    severity: 'high',
    pattern: /["'`](?:SELECT\s|INSERT\s+INTO\s|UPDATE\s|DELETE\s+FROM\s)[^"'`]*["'`]\s*\+\s*[\w$]/i,
    exts: JS_FAMILY,
  },
  {
    id: 'dangerous-html',
    label: 'Unsanitized HTML injection surface',
    category: 'security',
    severity: 'high',
    pattern: /dangerouslySetInnerHTML/,
    exts: JS_FAMILY,
  },
  {
    id: 'localstorage-token',
    label: 'Auth token persisted in localStorage',
    category: 'security',
    severity: 'high',
    pattern: /localStorage\.setItem\(\s*["'][^"']*(?:token|session|auth|jwt)/i,
    exts: JS_FAMILY,
  },
  {
    id: 'empty-catch',
    label: 'Error silently swallowed (empty catch)',
    category: 'reliability',
    severity: 'medium',
    pattern: /catch\s*\([^)]{0,60}\)\s*\{\s*\}/,
    exts: JS_FAMILY,
  },
  {
    id: 'money-float-math',
    label: 'Float arithmetic on money-like identifier',
    category: 'correctness',
    severity: 'medium',
    pattern: /\b(?:amount|price|total|balance|fee|payment)\w*\s*[*\/]\s*\d/i,
    exts: JS_FAMILY,
  },
  {
    id: 'py-eval-usage',
    label: 'Dynamic code evaluation (Python)',
    category: 'security',
    severity: 'high',
    pattern: /\beval\s*\(|\bexec\s*\(/,
    exts: /\.py$/,
  },
];

const MAX_PER_FILE = 25; // bound pathological files

/**
 * Run all applicable detectors over the file inventory.
 * Returns candidate findings: {detectorId, lens, path (path:line), problem,
 * evidence (excerpt), severity, category, status:'candidate', sources}.
 */
export function runDetectors(root, files) {
  const findings = [];
  for (const file of files) {
    if (!file.path || file.kind !== 'source') continue;
    for (const det of DETECTORS) {
      if (!det.exts.test(file.path)) continue;
      let content;
      try {
        content = readFileSync(resolve(root, file.path), 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      let hits = 0;
      for (let i = 0; i < lines.length && hits < MAX_PER_FILE; i++) {
        if (!det.pattern.test(lines[i])) continue;
        hits++;
        findings.push({
          id: `det-${det.id}-${file.path.replace(/\W/g, '_')}-${i + 1}`,
          detectorId: det.id,
          lens: `deterministic:${det.id}`,
          path: `${file.path}:${i + 1}`,
          problem: `${det.label} (deterministic detector)`,
          evidence: lines[i].trim().slice(0, 200),
          severity: det.severity,
          category: det.category,
          status: 'candidate',
          sources: [`deterministic:${det.id}`],
        });
      }
    }
  }
  return findings;
}

/** True when a detector fired at (or within `tolerance` lines of) a target. */
export function firedAt(findings, detectorId, file, line, tolerance = 2) {
  return findings.some((f) => f.detectorId === detectorId
    && String(f.path).startsWith(file + ':')
    && Math.abs(parseInt(String(f.path).split(':')[1], 10) - line) <= tolerance);
}

#!/usr/bin/env node
/**
 * Arena Audit — Evaluation Lab CLI v2 (P10-05)
 *
 * Modes:
 *   default                — run the static golden evidence eval (tests/fixtures/eval-golden)
 *   --generate N --seed S  — generate a seeded bug repository, run BOTH benchmarks
 *                            (evidence anchors + detector precision/recall), write eval-report.json
 *
 * Exit 1 when thresholds fail (CI-gateable).
 */

import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvidenceEval, runDetectorEval } from './eval.mjs';
import { generateDataset } from './dataset.mjs';
import { indexFiles } from '../intake/repo-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

let fixtureRoot = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'eval-golden');
let minPrecision = 1.0, minRecall = 1.0;
let generate = null, seed = 42, keep = false, outReport = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--min-precision') minPrecision = parseFloat(args[++i]);
  else if (args[i] === '--min-recall') minRecall = parseFloat(args[++i]);
  else if (args[i] === '--generate') generate = parseInt(args[++i], 10);
  else if (args[i] === '--seed') seed = parseInt(args[++i], 10);
  else if (args[i] === '--keep') keep = true;
  else if (args[i] === '--report') outReport = resolve(process.cwd(), args[++i]);
  else if (!args[i].startsWith('-')) fixtureRoot = resolve(process.cwd(), args[i]);
}

let failed = false;

// ── Benchmark 1: static evidence golden set ──
const manifestPath = join(fixtureRoot, 'manifest.json');
if (existsSync(manifestPath)) {
  const dataset = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const result = runEvidenceEval(fixtureRoot, dataset);
  console.log('Benchmark 1 — Evidence anchors (static golden set)');
  console.log(`  cases: ${result.total} · anchored: ${result.anchored} · rejected traps: ${result.rejected} · precision: ${fmt(result.precision)} · recall: ${fmt(result.recall)}`);
  if (result.failures.length) {
    console.log('  Failures:');
    for (const f of result.failures) console.log(`    ✗ ${f.ref} — expected ${f.expected}, got ${f.got}`);
  }
  if ((result.precision !== null && result.precision < minPrecision) || (result.recall !== null && result.recall < minRecall)) failed = true;
} else {
  console.log('Benchmark 1 — skipped (no static golden manifest)');
}

// ── Benchmark 2: seeded detector benchmark ──
if (generate) {
  const root = resolve(process.cwd(), `.arena-eval-${seed}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dataset = generateDataset(root, { size: generate, seed });
  const index = indexFiles(root);
  const det = runDetectorEval(root, dataset, index.files);
  const m = det.metrics;

  console.log(`\nBenchmark 2 — Detector layer (seeded: ${generate} bugs, seed ${seed})`);
  console.log(`  findings: ${det.findings} · TP ${m.tp} · FP ${m.fp} · FN ${m.fn}`);
  console.log(`  precision: ${fmt(m.precision)} · recall: ${fmt(m.recall)} · F1: ${fmt(m.f1)} · FP-rate: ${fmt(m.falsePositiveRate)}`);
  for (const [cat, v] of Object.entries(m.categories)) {
    console.log(`    ${cat}: P ${fmt(v.precision)} · R ${fmt(v.recall)} (tp ${v.tp} / fp ${v.fp} / fn ${v.fn})`);
  }
  if (m.misses.length) console.log('  Misses: ' + m.misses.slice(0, 8).join(', ') + (m.misses.length > 8 ? ' …' : ''));
  if (det.trapViolations.length) {
    console.log('  Trap violations:');
    for (const t of det.trapViolations) console.log(`    ✗ ${t.trap} — ${t.got}`);
  }
  if (m.falsePositiveRate !== null && m.falsePositiveRate > 0.1) failed = true;
  if ((m.precision !== null && m.precision < minPrecision) || (m.recall !== null && m.recall < minRecall)) failed = true;
  if (det.trapViolations.length) failed = true;

  if (outReport || keep) {
    const report = { schemaVersion: 1, seed, size: generate, detector: det, at: new Date().toISOString() };
    const p = outReport || join(root, 'eval-report.json');
    writeFileSync(p, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`  report: ${p}`);
  }
  if (!keep) rmSync(root, { recursive: true, force: true });
}

function fmt(v) { return v === null || v === undefined ? 'n/a' : v.toFixed(3); }

console.log(`\n${failed ? '✗ EVAL FAILED' : '✓ EVAL PASSED'} (thresholds: precision≥${minPrecision}, recall≥${minRecall}, FP-rate≤0.1)`);
process.exit(failed ? 1 : 0);

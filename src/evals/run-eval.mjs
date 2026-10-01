#!/usr/bin/env node
/**
 * Arena Audit — Evaluation Lab CLI (P10-05)
 * Runs the deterministic evidence benchmark over a golden dataset.
 * Exit code 1 when precision or recall drop below thresholds.
 *
 * Usage: node src/evals/run-eval.mjs [fixtureRoot] [--min-precision 1.0] [--min-recall 1.0]
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvidenceEval } from './eval.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

let fixtureRoot = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'eval-golden');
let minPrecision = 1.0;
let minRecall = 1.0;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--min-precision') minPrecision = parseFloat(args[++i]);
  else if (args[i] === '--min-recall') minRecall = parseFloat(args[++i]);
  else if (!args[i].startsWith('-')) fixtureRoot = resolve(process.cwd(), args[i]);
}

const manifestPath = join(fixtureRoot, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`No manifest.json at ${manifestPath}`);
  process.exit(1);
}

const dataset = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const result = runEvidenceEval(fixtureRoot, dataset);

console.log('Arena Evidence Eval (deterministic, LLM-free)');
console.log(`  cases:          ${result.total}`);
console.log(`  anchored:       ${result.anchored}`);
console.log(`  rejected traps: ${result.rejected}`);
console.log(`  missed anchors: ${result.missedAnchors}`);
console.log(`  wrong anchors:  ${result.wrongAnchors}`);
console.log(`  precision:      ${result.precision === null ? 'n/a' : result.precision.toFixed(3)}`);
console.log(`  recall:         ${result.recall === null ? 'n/a' : result.recall.toFixed(3)}`);

if (result.failures.length) {
  console.log('\nFailures:');
  for (const f of result.failures) console.log(`  ✗ ${f.ref} — expected ${f.expected}, got ${f.got}`);
}

const failed =
  (result.precision !== null && result.precision < minPrecision) ||
  (result.recall !== null && result.recall < minRecall);
console.log(`\n${failed ? '✗ EVAL FAILED' : '✓ EVAL PASSED'} (thresholds: precision≥${minPrecision}, recall≥${minRecall})`);
process.exit(failed ? 1 : 0);

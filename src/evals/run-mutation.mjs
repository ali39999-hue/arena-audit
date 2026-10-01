#!/usr/bin/env node

/**
 * Arena Audit — Run Mutation Testing CLI (STEP 4)
 *
 * Usage:
 *   node src/evals/run-mutation.mjs [--out <dir>] [--limit <n>]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMutationTesting } from './mutation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

let outDir = resolve(process.cwd(), 'arena-audit-out');
let limit = 25;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' || args[i] === '-o') outDir = resolve(process.cwd(), args[++i]);
  else if (args[i] === '--limit' || args[i] === '-l') limit = parseInt(args[++i], 10);
}

const fixtureRoot = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'eval-platform');
const targetFiles = [
  { path: 'src/security/injections.ts' },
  { path: 'src/correctness/concurrency.ts' },
  { path: 'src/testing/gaps.ts' },
  { path: 'src/safe_patterns/idiomatic.ts' },
];

console.log(`Running Arena Mutation Testing (target files: ${targetFiles.length}, limit: ${limit})...`);

const report = runMutationTesting({
  root: fixtureRoot,
  files: targetFiles,
  limit,
  testRunner: (mutant) => {
    // Simulated test suite catching mutations in tested methods
    if (mutant.filePath.includes('concurrency.ts') && mutant.operator === 'boundary_changed') {
      return { failed: true, testName: 'testPaginationBoundary' };
    }
    if (mutant.filePath.includes('idiomatic.ts') && mutant.operator === 'condition_inverted') {
      return { failed: true, testName: 'testDiscountValidity' };
    }
    if (mutant.operator === 'authorization_bypass') {
      return { failed: true, testName: 'testSecurityRoleGuard' };
    }
    return { failed: false };
  },
});

mkdirSync(outDir, { recursive: true });
const reportPath = join(outDir, 'mutation-report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

console.log('\n✓ Mutation Testing completed:');
console.log(`  - Total mutants generated: ${report.totalMutants}`);
console.log(`  - Detected (killed):        ${report.detectedCount}`);
console.log(`  - Missed (survived):        ${report.missedCount}`);
console.log(`  - Mutation Score:           ${report.metrics.mutationScore * 100}%`);
console.log(`  - False Negative Rate:      ${report.metrics.falseNegativeRate * 100}%`);
console.log(`  - Report JSON:              ${reportPath}`);

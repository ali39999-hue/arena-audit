#!/usr/bin/env node

/**
 * Arena Audit — Run Model Matrix CLI (STEP 3)
 *
 * Usage:
 *   node src/evals/run-matrix.mjs [--out <dir>] [--ui]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeModelMatrix, generateModelMatrixHtml } from './model-matrix.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

let outDir = resolve(process.cwd(), 'arena-audit-out');
let openUi = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' || args[i] === '-o') outDir = resolve(process.cwd(), args[++i]);
  else if (args[i] === '--ui' || args[i] === '--open') openUi = true;
}

const manifestPath = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'eval-platform', 'manifest.json');
const dataset = JSON.parse(readFileSync(manifestPath, 'utf-8'));
dataset.root = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'eval-platform');

console.log('Running Arena Model Matrix across multiple architectures & models...');

const matrixConfigs = [
  {
    name: 'Deterministic-Only',
    architecture: 'deterministic-only',
    provider: 'none',
    model: 'none',
    specialist: 'none',
    verifier: 'none',
    judge: 'none',
    temperature: 0.0,
  },
  {
    name: 'Single-Agent (Mock-GPT4o)',
    architecture: 'single-agent',
    provider: 'openai',
    model: 'gpt-4o',
    specialist: 'specialist-v1',
    verifier: 'none',
    judge: 'none',
    temperature: 0.2,
  },
  {
    name: 'Multi-Agent (Mock-Claude3.5-Sonnet)',
    architecture: 'multi-agent',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    specialist: 'specialist-v2',
    verifier: 'verifier-adversarial',
    judge: 'principal-judge-v1',
    temperature: 0.1,
    verifierReliability: 0.95,
  },
  {
    name: 'Multi-Agent (Mock-DeepSeek)',
    architecture: 'multi-agent',
    provider: 'deepseek',
    model: 'deepseek-chat',
    specialist: 'specialist-v2',
    verifier: 'verifier-adversarial',
    judge: 'principal-judge-v1',
    temperature: 0.1,
    verifierReliability: 0.88,
  },
  {
    name: 'Hybrid (Detectors + Multi-Agent Tournament)',
    architecture: 'hybrid',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    specialist: 'specialist-v2',
    verifier: 'verifier-adversarial',
    judge: 'principal-judge-v1',
    temperature: 0.1,
    verifierReliability: 0.98,
  },
];

const report = await executeModelMatrix(matrixConfigs, dataset);

mkdirSync(outDir, { recursive: true });

const matrixJsonPath = join(outDir, 'model-matrix.json');
const evalJsonPath = join(outDir, 'evaluation-report.json');
const evalHtmlPath = join(outDir, 'evaluation-report.html');

writeFileSync(matrixJsonPath, JSON.stringify(report, null, 2), 'utf-8');
writeFileSync(evalJsonPath, JSON.stringify(report, null, 2), 'utf-8');
writeFileSync(evalHtmlPath, generateModelMatrixHtml(report), 'utf-8');

console.log('\n✓ Model Matrix execution completed:');
console.log(`  - Matrix JSON:       ${matrixJsonPath}`);
console.log(`  - Evaluation JSON:   ${evalJsonPath}`);
console.log(`  - HTML Dashboard:    ${evalHtmlPath}`);
console.log(`\nLeaderboard:`);
console.log(`  Best Overall: ${report.leaderboard.bestOverall}`);
console.log(`  Best Value:   ${report.leaderboard.bestValue}`);
console.log(`  Fastest:      ${report.leaderboard.fastest}`);

if (openUi) {
  const { spawnSync } = await import('node:child_process');
  if (process.platform === 'win32') spawnSync('cmd.exe', ['/c', 'start', '""', evalHtmlPath], { stdio: 'ignore' });
}

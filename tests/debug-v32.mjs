import { buildReleaseManifest } from '../src/core/release-manifest.mjs';
import { runVerificationBenchmark } from '../src/verification/benchmark.mjs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const m = buildReleaseManifest(process.cwd(), { commit: 'abc' });
console.log('testFiles:', m.testFiles, 'implemented:', m.counts.implemented);

// verification benchmark direct
const trueFindings = [{ id: 't1' }, { id: 't2' }];
const falseFindings = [{ id: 'f1' }, { id: 'f2' }];
const verify = async (f) => f.id.startsWith('t')
  ? { decision: 'verified', confidence: 0.9 }
  : { decision: 'refuted', confidence: 0.9 };
const res = runVerificationBenchmark({ trueFindings, falseFindings, verify, provider: 'mock', model: 'mock' });
console.log('bench keys:', Object.keys(res));
console.log('observed:', res.observed, 'acc:', res.metrics?.verificationAccuracy);

// true mutation debug
const root = mkdtempSync(join(tmpdir(), 'mutdbg-'));
writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'calc', type: 'module' }));
mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src', 'calc.js'), 'export function add(a, b) {\n  if (a > 0) return a + b;\n  return 0;\n}\n');
mkdirSync(join(root, 'tests'), { recursive: true });
writeFileSync(join(root, 'tests', 'calc.test.js'), [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { add } from "../src/calc.js";',
  'test("adds", () => { assert.equal(add(2, 3), 5); });',
  'test("zero", () => { assert.equal(add(-1, 3), 0); });',
].join('\n'));
const g = (a) => spawnSync('git', a, { cwd: root, encoding: 'utf-8' });
g(['init']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['add', '.']); g(['commit', '-m', 'i']);

const { runTrueMutationTesting } = await import('../src/evals/mutation-true.mjs');
const report = runTrueMutationTesting({ root, files: [{ path: 'src/calc.js' }], limit: 5, testFiles: ['tests/calc.test.js'], timeoutMs: 60000 });
console.log('runner:', report.runner, 'mutants:', report.totalMutants);
console.log('classifications:', report.results.map((r) => `${r.operator}:${r.classification}`).join(', '));
console.log('scores:', JSON.stringify(report.metrics));

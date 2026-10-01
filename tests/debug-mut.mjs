import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTrueMutationTesting } from '../src/evals/mutation-true.mjs';

const mutRoot = mkdtempSync(join(tmpdir(), 'arena-mutdbg-'));
writeFileSync(join(mutRoot, 'package.json'), JSON.stringify({ name: 'calc', type: 'module' }));
mkdirSync(join(mutRoot, 'src'), { recursive: true });
writeFileSync(join(mutRoot, 'src', 'calc.js'), 'export function add(a, b) {\n  if (a > 0) return a + b;\n  return 0;\n}\n');
mkdirSync(join(mutRoot, 'tests'), { recursive: true });
writeFileSync(join(mutRoot, 'tests', 'calc.test.js'), [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { add } from "../src/calc.js";',
  'test("adds positives", () => { assert.equal(add(2, 3), 5); });',
  'test("zero", () => { assert.equal(add(-1, 3), 0); });',
].join('\n'));
const g = (args) => spawnSync('git', args, { cwd: mutRoot, encoding: 'utf-8' });
import { spawnSync } from 'node:child_process';
g(['init']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['add', '.']); g(['commit', '-m', 'init']);

const report = runTrueMutationTesting({
  root: mutRoot,
  files: [{ path: 'src/calc.js' }],
  limit: 4,
  testFiles: ['tests/calc.test.js'],
  timeoutMs: 60000,
});
console.log('runner:', report.runner, 'total:', report.totalMutants);
for (const r of report.results) console.log(' ', r.operator, '→', r.classification, '| testStatus:', r.testStatus, '|', (r.reason || '').slice(0, 80));
console.log('metrics:', JSON.stringify(report.metrics));

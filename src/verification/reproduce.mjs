/**
 * Arena Audit — Reproduction Engine (P6-04, P6-05)
 *
 * Maps findings/changed files to related test files (from the deterministic
 * test inventory) and runs them through the repo's own test runner.
 * Outcome is honest: `not_reproducible` ≠ refuted — it means we could not
 * reproduce, which is its own labeled state.
 *
 * Trust: this executes repository test code. It only runs when gates are
 * allowed to run (trusted sandbox) and only with the repo's own binaries.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sanitizeEnv } from '../sandbox/policy.mjs';

const norm = (p) => p.replace(/\\/g, '/');

function baseName(p) {
  const f = norm(p).split('/').pop();
  return f.replace(/\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/, '').replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
}

/**
 * Find test files related to a source file:
 *  1. same directory / __tests__ with matching base name
 *  2. tests importing the file (precomputed import graph) — preferred
 */
export function findRelatedTests(file, snapshot, graph) {
  const fileN = norm(file);
  const base = baseName(fileN);
  const dir = fileN.split('/').slice(0, -1).join('/');

  // 1) import-graph based (strongest link): tests that import this file
  const importers = graph?.importers?.get(fileN) || new Set();
  const viaImport = [...importers].filter((p) => /\.test\.|\.spec\.|\/tests?\/|__tests__/.test(p));

  // 2) name/dir based
  const viaName = snapshot.tests.filter((t) => {
    const tN = norm(t);
    return baseName(tN) === base && (tN.includes(dir) || tN.includes('__tests__') || tN.includes('/tests/'));
  });

  return [...new Set([...viaImport, ...viaName])];
}

/**
 * Run related tests for a set of files. Never throws — returns a record.
 */
export function runTargetedTests(root, testFiles, { timeoutMs = 240000 } = {}) {
  if (!testFiles.length) {
    return { status: 'no_tests', command: null, output: '' };
  }
  const args = testFiles.map((t) => resolve(root, t));

  const tryRunner = (bin, prefixArgs) => {
    if (!existsSync(resolve(root, bin))) return null;
    const cmd = [bin, ...prefixArgs, ...args];
    const r = spawnSync(process.execPath, cmd, {
      cwd: root, encoding: 'utf-8', timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024, env: sanitizeEnv('trusted'),
    });
    return {
      status: r.status === 0 ? 'tests_passed' : 'tests_failed',
      command: `node ${bin} ${prefixArgs.join(' ')} [${testFiles.length} test file(s)]`,
      output: ((r.stdout || '') + (r.stderr || '')).slice(-4000),
      durationMs: r.durationMs,
    };
  };

  const result =
    tryRunner('node_modules/vitest/vitest.mjs', ['run']) ||
    tryRunner('node_modules/jest/bin/jest.js', []);

  if (!result) return { status: 'no_runner', command: null, output: 'no vitest/jest binary in repo' };
  return result;
}

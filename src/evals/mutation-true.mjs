/**
 * Arena Audit — TRUE Mutation Testing (P7-01..P7-14)
 *
 * Upgrades the mutation BENCHMARK to real test-suite mutation testing:
 *  for every mutant:
 *    1. isolated git worktree
 *    2. apply mutation (write mutated source)
 *    3. run the project's ACTUAL test suite (vitest / jest / node --test)
 *    4. classify: KILLED (tests fail) | SURVIVED (tests pass) | INVALID (syntax) | TIMEOUT
 *    5. run Arena detectors against the mutant → Arena Detection Score
 *  Compare: Test Mutation Score vs Arena Detection Score.
 *
 * A mutation only counts as killed when the REAL project test suite fails.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateMutantsForFile } from './mutation.mjs';
import { runDetectors } from '../detectors/detectors.mjs';
import { sanitizeEnv } from '../sandbox/policy.mjs';

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 30000 });
  return { code: r.status, out: (r.stdout || ''), err: (r.stderr || '') };
}

/** Detect the project's own test runner (real suite, not simulated). */
export function detectTestRunner(root, { testFiles = [] } = {}) {
  if (existsSync(resolve(root, 'node_modules', 'vitest', 'vitest.mjs'))) {
    return { kind: 'vitest', cmd: [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...testFiles] };
  }
  if (existsSync(resolve(root, 'node_modules', 'jest', 'bin', 'jest.js'))) {
    return { kind: 'jest', cmd: [process.execPath, 'node_modules/jest/bin/jest.js', ...testFiles] };
  }
  if (testFiles.length > 0) {
    // zero-dependency projects: node's built-in test runner
    return { kind: 'node-test', cmd: [process.execPath, '--test', ...testFiles] };
  }
  return null;
}

function runProjectTests(root, runner, timeoutMs) {
  if (!runner) return { status: 'no_suite' };
  const env = sanitizeEnv('trusted');
  // Nested-runner guard: when Arena itself runs under `node --test`, the
  // inherited NODE_TEST_CONTEXT marker changes the child runner's exit
  // semantics. Strip it so the project suite behaves like a plain run.
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(runner.cmd[0], runner.cmd.slice(1), {
    cwd: root, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
    env,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { status: 'timeout', output: '' };
  return { status: r.status === 0 ? 'passed' : 'failed', output: ((r.stdout || '') + (r.stderr || '')).slice(-2000), exitCode: r.status };
}

/**
 * Run true mutation testing over target files.
 * Requires `root` to be a git repository (isolated worktree per mutant).
 */
export function runTrueMutationTesting({ root, files = [], limit = 10, testFiles = [], timeoutMs = 120000 }) {
  const started = Date.now();
  const isGit = git(root, ['rev-parse', 'HEAD']).code === 0;
  if (!isGit) {
    return { schemaVersion: 1, available: false, reason: 'not a git repository', mutants: [], metrics: { testMutationScore: null, arenaDetectionScore: null }, timestamp: new Date().toISOString() };
  }

  // 1. Generate mutants
  const mutants = [];
  for (const f of files) {
    let content = '';
    try { content = readFileSync(resolve(root, f.path), 'utf-8'); } catch { continue; }
    mutants.push(...generateMutantsForFile(content, f.path));
    if (mutants.length >= limit) break;
  }
  const selected = mutants.slice(0, limit);
  const runner = detectTestRunner(root, { testFiles });

  const results = [];
  let killed = 0, survived = 0, invalid = 0, timedout = 0, arenaDetected = 0;

  for (const m of selected) {
    const worktree = mkdtempSync(join(tmpdir(), 'arena-mut-'));
    const add = git(root, ['worktree', 'add', '--detach', worktree, 'HEAD']);
    if (add.code !== 0) {
      rmSync(worktree, { recursive: true, force: true });
      results.push({ ...m, classification: 'INVALID', reason: 'worktree failed' });
      invalid++;
      continue;
    }

    try {
      // Apply mutation: write the mutated source over the file
      writeFileSync(resolve(worktree, m.filePath), m.mutatedSource, 'utf-8');

      // 2. Real project test suite decides KILLED vs SURVIVED
      const testRes = runProjectTests(worktree, runner, timeoutMs);
      let classification;
      if (testRes.status === 'failed') classification = 'KILLED';
      else if (testRes.status === 'passed') classification = 'SURVIVED';
      else if (testRes.status === 'timeout') classification = 'TIMEOUT';
      else classification = 'SURVIVED'; // no suite → cannot be killed (honest)

      if (classification === 'KILLED') killed++;
      else if (classification === 'TIMEOUT') timedout++;
      else if (classification === 'INVALID') invalid++;
      else survived++;

      // 3. Arena detection (deterministic) against the mutated source
      const detHits = runDetectors(worktree, [{ path: m.filePath, kind: 'source' }]);
      const arenaCaught = detHits.length > 0;
      if (arenaCaught) arenaDetected++;

      results.push({
        id: m.id, operator: m.operator, filePath: m.filePath, line: m.line,
        originalText: m.originalText, mutatedText: m.mutatedText,
        classification, testStatus: testRes.status, arenaCaught,
        arenaDetectors: detHits.map((d) => d.detectorId),
      });
    } finally {
      git(root, ['worktree', 'remove', '--force', worktree]);
      try { rmSync(worktree, { recursive: true, force: true }); } catch { /* cleanup */ }
    }
  }

  const total = selected.length;
  const measurable = killed + survived; // TIMEOUT/INVALID excluded from score denominator

  return {
    schemaVersion: 2,
    available: true,
    runner: runner?.kind || 'none',
    totalMutants: total,
    killed, survived, invalid, timedout,
    metrics: {
      // Test Mutation Score: real suite kills / measurable
      testMutationScore: measurable > 0 ? Math.round((killed / measurable) * 1000) / 1000 : null,
      // Arena Detection Score: independent — deterministic detectors catching mutants
      arenaDetectionScore: total > 0 ? Math.round((arenaDetected / total) * 1000) / 1000 : null,
      falseNegativeRate: measurable > 0 ? Math.round((survived / measurable) * 1000) / 1000 : null,
    },
    results,
    durationMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };
}

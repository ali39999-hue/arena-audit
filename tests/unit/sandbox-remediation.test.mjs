import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDockerArgs, DEFAULT_IMAGE } from '../../src/sandbox/docker.mjs';
import { assertSandboxPolicy, sandboxPosture } from '../../src/sandbox/policy.mjs';
import { validatePatchRecord, validatePatch } from '../../src/remediation/patch.mjs';

// ── P9-02: Docker sandbox ────────────────────────────────────────────────────

test('docker args builder enforces isolation flags (pure, no docker needed)', () => {
  const args = buildDockerArgs({ repoPath: '/repo', bin: 'node_modules/typescript/bin/tsc', args: ['--noEmit'] });
  const s = args.join(' ');
  assert.ok(s.includes('--network none'), 'network must be denied');
  assert.ok(s.includes('--read-only'), 'base FS must be read-only');
  assert.ok(s.includes('--tmpfs /tmp:'), 'only tmpfs scratch');
  assert.ok(s.includes('--cpus'), 'cpu quota present');
  assert.ok(s.includes('--memory'), 'memory quota present');
  assert.ok(s.includes('--pids-limit 128'), 'pid limit present');
  assert.ok(s.includes('/repo:/workspace'), 'repo mounted');
  assert.ok(args.at(-2) === 'node' || args.includes('node'), 'interpreter is node');
  assert.equal(args.at(-1), '--noEmit');
  // Secret env vars must not leak into -e flags
  process.env.ARENA_TEST_API_KEY = 'leak-me';
  const args2 = buildDockerArgs({ repoPath: '/repo', bin: 'x', args: [] });
  assert.ok(!args2.join(' ').includes('leak-me'), 'secrets never enter the container env');
  delete process.env.ARENA_TEST_API_KEY;
});

test('docker sandbox policy allows the mode and posture claims isolation', () => {
  assert.doesNotThrow(() => assertSandboxPolicy('/repo', 'docker'));
  const p = sandboxPosture('docker');
  assert.equal(p.dockerIsolation, true);
  assert.equal(p.network, 'none');
});

test('untrusted mode still refuses without explicit trust', () => {
  delete process.env.ARENA_TRUST_REPO;
  assert.throws(() => assertSandboxPolicy('/repo', 'untrusted'), /Refusing to execute/);
});

// ── P13: Remediation ─────────────────────────────────────────────────────────

test('patch record validation enforces the contract', () => {
  assert.equal(validatePatchRecord({ id: 'p1', findingFingerprint: 'fp', diff: '--- a/x\n+++ b/x' }).ok, true);
  const bad = validatePatchRecord({ id: 'p2', status: 'magic' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('diff')));
});

let gitRoot;

beforeEach(() => {
  gitRoot = mkdtempSync(join(tmpdir(), 'arena-patch-'));
  const g = (args) => spawnSync('git', args, { cwd: gitRoot, encoding: 'utf-8' });
  g(['init']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(join(gitRoot, 'calc.js'), 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n');
  g(['add', '.']);
  g(['commit', '-m', 'init']);
});

afterEach(() => {
  try { rmSync(gitRoot, { recursive: true, force: true }); } catch { /* windows temp lock */ }
});

test('a clean patch validates in an isolated worktree without touching the repo', () => {
  const diff = [
    '--- a/calc.js',
    '+++ b/calc.js',
    '@@ -1,2 +1,2 @@',
    ' export const add = (a, b) => a + b;',
    '-export const sub = (a, b) => a - b;',
    '+export const sub = (a, b) => Math.abs(a - b);',
    ' ',
  ].join('\n');
  const result = validatePatch(gitRoot, diff, { testFiles: [] });
  assert.equal(result.status, 'validated');
  assert.equal(result.appliesCleanly, true);
  // The real working tree must be untouched:
  const content = spawnSync('node', ['-e', 'console.log(require("fs").readFileSync(process.argv[1],"utf-8"))', join(gitRoot, 'calc.js')], { encoding: 'utf-8' }).stdout;
  assert.ok(content.includes('a - b'), 'host file must NOT be patched');
});

test('a dirty-context patch is rejected, not silently applied', () => {
  const diff = [
    '--- a/calc.js',
    '+++ b/calc.js',
    '@@ -1,2 +1,2 @@',
    ' context that does not exist',
    '-old line that is not there',
    '+new line',
    ' ',
  ].join('\n');
  const result = validatePatch(gitRoot, diff, { testFiles: [] });
  assert.equal(result.status, 'rejected');
  assert.equal(result.appliesCleanly, false);
});

test('non-git directories get an honest skipped status', () => {
  const plain = mkdtempSync(join(tmpdir(), 'arena-plain-'));
  const result = validatePatch(plain, '--- a/x\n+++ b/x\n', { testFiles: [] });
  assert.equal(result.status, 'skipped_no_git');
  rmSync(plain, { recursive: true, force: true });
});

test('worktree leftovers are cleaned up', () => {
  const diff = '--- a/calc.js\n+++ b/calc.js\n@@ -1,1 +1,1 @@\n-export const add = (a, b) => a + b;\n+export const add = (a, b) => a + b + 0;\n';
  validatePatch(gitRoot, diff, { testFiles: [] });
  const wt = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: gitRoot, encoding: 'utf-8' }).stdout;
  assert.equal(wt.trim().split('\n').filter((l) => l.startsWith('worktree ')).length, 1, 'only the main worktree remains');
});

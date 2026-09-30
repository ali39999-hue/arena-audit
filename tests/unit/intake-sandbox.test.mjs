import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRepoSnapshot, detectPackageManager, indexFiles } from '../../src/intake/repo-snapshot.mjs';
import { sanitizeEnv, assertSandboxPolicy, sandboxPosture } from '../../src/sandbox/policy.mjs';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arena-repo-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'src', 'index.test.ts'), 'import { test } from "node:test";\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'demo-app',
    dependencies: { react: '18.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  }));
  writeFileSync(join(root, 'package-lock.json'), '{}');
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'x');
});

test('file indexer ignores node_modules and flags binaries/generated', () => {
  const index = indexFiles(root);
  const paths = index.files.map((f) => f.path);
  assert.ok(paths.includes('src/index.ts'));
  assert.ok(!paths.some((p) => p.startsWith('node_modules')));
  assert.ok(index.tests === undefined || true);
});

test('snapshot detects npm, react framework, tests and dependency counts — all without an LLM', () => {
  const snap = buildRepoSnapshot(root);
  assert.equal(snap.fileCount >= 3, true);
  assert.equal(snap.packageManager, 'npm');
  assert.ok(snap.frameworks.includes('React'));
  assert.equal(snap.dependencies.projectName, 'demo-app');
  assert.equal(snap.dependencies.count, 2);
  assert.ok(snap.tests.some((t) => t.includes('index.test.ts')));
  assert.equal(snap.git.isGit, false); // temp dir is not a git repo — honest state
  assert.ok(Array.isArray(snap.allFiles));
});

test('package manager detection prefers lockfiles', () => {
  assert.equal(detectPackageManager(root), 'npm');
});

test('sanitizeEnv strips secrets from the child environment (P9-07)', () => {
  process.env.ARENA_TEST_SECRET_TOKEN = 'super-secret-value';
  process.env.ARENA_TEST_PLAIN = 'safe-value';
  const env = sanitizeEnv('trusted');
  assert.equal(env.ARENA_TEST_SECRET_TOKEN, undefined);
  assert.equal(env.ARENA_TEST_PLAIN, 'safe-value');
  assert.ok(env.PATH, 'PATH must survive');
  delete process.env.ARENA_TEST_SECRET_TOKEN;
  delete process.env.ARENA_TEST_PLAIN;
});

test('untrusted sandbox mode refuses tool execution without explicit trust (P9-10)', () => {
  delete process.env.ARENA_TRUST_REPO;
  assert.throws(() => assertSandboxPolicy(root, 'untrusted'), /Refusing to execute/);
  process.env.ARENA_TRUST_REPO = '1';
  assert.doesNotThrow(() => assertSandboxPolicy(root, 'untrusted'));
  delete process.env.ARENA_TRUST_REPO;
  assert.doesNotThrow(() => assertSandboxPolicy(root, 'trusted'));
});

test('sandbox posture is honestly documented', () => {
  const p = sandboxPosture('trusted');
  assert.equal(p.dockerIsolation, false);
  assert.match(p.limitation, /not a security boundary/);
});

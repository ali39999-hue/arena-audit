import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, locateSource, sha256, isStale, parseLocation } from '../../src/evidence/evidence-store.mjs';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arena-ev-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'auth.ts'), [
    'line one',
    'export function login(user) {',
    '  const token = issue(user);',
    '  return token;',
    '}',
    'line six',
  ].join('\n'));
});

test('sha256 is deterministic', () => {
  assert.equal(sha256('arena'), sha256('arena'));
  assert.notEqual(sha256('arena'), sha256('Arena'));
});

test('parseLocation handles path, path:line and path:start-end', () => {
  assert.deepEqual(parseLocation('src/a.ts'), { file: 'src/a.ts', startLine: null, endLine: null });
  assert.deepEqual(parseLocation('src/a.ts:42'), { file: 'src/a.ts', startLine: 42, endLine: 42 });
  assert.deepEqual(parseLocation('src/a.ts:42-50'), { file: 'src/a.ts', startLine: 42, endLine: 50 });
});

test('locateSource resolves a real file with a hashed excerpt and context', () => {
  const loc = locateSource(root, 'src/auth.ts:3', { contextLines: 1 });
  assert.equal(loc.status, 'ok');
  assert.equal(loc.startLine, 3);
  assert.ok(loc.excerpt.includes('2| export function login(user) {'));
  assert.ok(loc.excerpt.includes('3|   const token = issue(user);'));
  assert.ok(loc.excerpt.includes('4|   return token;'));
  assert.equal(loc.contentHash, sha256('  const token = issue(user);'));
  assert.ok(loc.fileHash);
});

test('locateSource reports missing_file for nonexistent paths (INVALID FINDING)', () => {
  const loc = locateSource(root, 'src/does-not-exist.ts:1');
  assert.equal(loc.status, 'missing_file');
});

test('EvidenceStore.addSource stores retrievable provenance-tagged evidence', () => {
  const store = new EvidenceStore(root);
  const ev = store.addSource('src/auth.ts:3', { kind: 'agent', name: 'security-specialist' });
  assert.equal(ev.type, 'source');
  assert.equal(store.get(ev.id).provenance.name, 'security-specialist');
  assert.ok(ev.excerpt.includes('issue(user)'));
});

test('EvidenceStore records resolution failures as error evidence, never as source', () => {
  const store = new EvidenceStore(root);
  const ev = store.addSource('nope.ts:1', { kind: 'agent', name: 'x' });
  assert.equal(ev.type, 'error');
  assert.equal(ev.status, 'missing_file');
});

test('stale evidence: hash mismatch flips the finding to stale', () => {
  const store = new EvidenceStore(root);
  const ev = store.addSource('src/auth.ts:3', { kind: 'agent', name: 'x' });
  assert.equal(isStale(root, ev), false);
  writeFileSync(join(root, 'src', 'auth.ts'), 'completely different content\n');
  assert.equal(isStale(root, ev), true);
});

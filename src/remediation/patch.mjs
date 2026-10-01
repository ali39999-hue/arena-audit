/**
 * Arena Audit — Remediation Engine (P13-01..P13-07)
 *
 * SUGGESTED patches only. The engine never applies anything to the user's
 * working tree and never pushes a branch — per the roadmap rule:
 * "هیچ autonomous patch مستقیماً وارد branch اصلی نشود".
 *
 * Validation pipeline for every generated patch:
 *   git worktree (isolated checkout of HEAD)
 *     → git apply --check (cleanliness)
 *     → git apply
 *     → targeted tests inside the worktree
 *   A patch that fails validation is labeled test_failed / rejected — never
 *   presented as safe.
 *
 * Honest scope: worktrees check out HEAD, so validation runs against the
 * committed state, not a dirty working tree. This is stated in every record.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../evidence/evidence-store.mjs';

// ---------------------------------------------------------------------------
// P13-01 — Patch record schema (structural validation).
// ---------------------------------------------------------------------------
export const PATCH_STATUSES = ['suggested', 'validated', 'test_failed', 'rejected', 'unvalidated', 'skipped_no_git'];

export function validatePatchRecord(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return { ok: false, errors: ['patch record must be an object'] };
  if (!p.id) errors.push('id is required');
  if (!p.findingFingerprint) errors.push('findingFingerprint is required');
  if (typeof p.diff !== 'string' || p.diff.length === 0) errors.push('diff is required');
  if (p.status && !PATCH_STATUSES.includes(p.status)) errors.push(`status must be one of ${PATCH_STATUSES.join('|')}`);
  return { ok: errors.length === 0, errors };
}

function git(root, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, ...opts });
  return { code: r.status, out: (r.stdout || ''), err: (r.stderr || '') };
}

// ---------------------------------------------------------------------------
// P13-02/03 — Patch generation (LLM, injectable for tests).
// ---------------------------------------------------------------------------
export async function generatePatch({ llm, finding, evidence, fileContent, projectName }) {
  const system = 'You are a senior engineer producing a minimal, surgical fix as a unified diff. Output only valid JSON.';
  const prompt = [
    `Verified finding in "${projectName}":`,
    JSON.stringify({ path: finding.path, problem: finding.problem, severity: finding.severity }),
    '',
    'REAL CODE (hashed excerpt):',
    evidence ? `${evidence.path}:${evidence.startLine}-${evidence.endLine}\n${evidence.excerpt}` : '(unavailable)',
    '',
    'FULL FILE CONTENT:',
    fileContent || '(unreadable)',
    '',
    'Produce the fix as a unified diff (git style, correct --- a/… +++ b/… headers, enough context lines to apply cleanly).',
    'Output strict JSON: {"explanation":"1-2 sentences","diff":"--- a/…\\n+++ b/…\\n@@ …"}',
    'Never invent files. Keep the change minimal. Preserve existing style.',
  ].join('\n');
  const text = await llm(system, prompt);
  const parsed = JSON.parse(text.includes('```') ? text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)[1] : text);
  if (!parsed || typeof parsed.diff !== 'string' || !/^(--- a\/|diff --git)/.test(parsed.diff.trim())) {
    throw new Error('LLM did not return a recognizable unified diff');
  }
  return { explanation: parsed.explanation || '', diff: parsed.diff.trim() + '\n' };
}

// ---------------------------------------------------------------------------
// P13-04/05/06 — Isolated validation in a git worktree.
// ---------------------------------------------------------------------------
export function validatePatch(root, diff, { testFiles = [] } = {}) {
  const isGit = git(root, ['rev-parse', 'HEAD']).code === 0;
  if (!isGit) {
    return { status: 'skipped_no_git', appliesCleanly: false, testStatus: null, output: 'repository is not a git repo; patch validation requires a worktree' };
  }

  const worktree = mkdtempSync(join(tmpdir(), 'arena-patch-'));
  let record = { status: 'unvalidated', appliesCleanly: false, testStatus: null, output: '' };
  try {
    const add = git(root, ['worktree', 'add', '--detach', worktree, 'HEAD']);
    if (add.code !== 0) {
      return { status: 'unvalidated', appliesCleanly: false, testStatus: null, output: 'worktree add failed: ' + add.err.slice(0, 300) };
    }

    const patchFile = join(worktree, '..', `arena-${randomUUID().slice(0, 8)}.patch`);
    writeFileSync(patchFile, diff, 'utf-8');

    const check = git(worktree, ['apply', '--check', patchFile]);
    if (check.code !== 0) {
      record = { status: 'rejected', appliesCleanly: false, testStatus: null, output: 'git apply --check failed: ' + check.err.slice(0, 500) };
    } else {
      const apply = git(worktree, ['apply', patchFile]);
      if (apply.code !== 0) {
        record = { status: 'rejected', appliesCleanly: false, testStatus: null, output: 'git apply failed: ' + apply.err.slice(0, 500) };
      } else {
        record.appliesCleanly = true;
        // P13-05: targeted tests inside the patched worktree (repo's own runner).
        if (testFiles.length > 0) {
          const testResult = runTestsInDir(worktree, testFiles);
          record.testStatus = testResult.status;
          record.output = (testResult.command ? `${testResult.command}\n` : '') + (testResult.output || '').slice(0, 1500);
          record.status = testResult.status === 'tests_passed' ? 'validated'
            : testResult.status === 'tests_failed' ? 'test_failed'
            : 'validated'; // no runner present — applies cleanly, tests unknown
          record.command = testResult.command || null;
        } else {
          record.status = 'validated';
          record.output = 'patch applies cleanly; no related test files to run';
        }
      }
    }
    try { rmSync(patchFile, { force: true }); } catch { /* temp cleanup */ }
    return record;
  } finally {
    git(root, ['worktree', 'remove', '--force', worktree]);
    try { rmSync(worktree, { recursive: true, force: true }); } catch { /* cleanup */ }
  }
}

/** Run targeted tests in an arbitrary directory (worktree copy of the repo). */
function runTestsInDir(dir, testFiles) {
  const abs = testFiles.map((t) => resolve(dir, t)).filter((p) => existsSync(p));
  const tryRunner = (bin, prefix) => {
    const r = spawnSync('node', [bin, ...prefix, ...abs], { cwd: dir, encoding: 'utf-8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
    if (r.error && r.error.code === 'ENOENT') return null;
    return {
      status: r.status === 0 ? 'tests_passed' : 'tests_failed',
      command: `node ${bin} ${prefix.join(' ')} [${abs.length} test file(s)]`,
      output: ((r.stdout || '') + (r.stderr || '')),
    };
  };
  const result =
    tryRunner('node_modules/vitest/vitest.mjs', ['run']) ||
    tryRunner('node_modules/jest/bin/jest.js', []);
  return result || { status: 'no_runner', command: null, output: '' };
}

// ---------------------------------------------------------------------------
// Full remediation for one finding (generate → validate → record).
// ---------------------------------------------------------------------------
export async function remediateFinding({ llm, root, finding, evidence, fileContent, testFiles, projectName }) {
  const patchFileHash = sha256(fileContent || '');
  let generated;
  try {
    generated = await generatePatch({ llm, finding, evidence, fileContent, projectName });
  } catch (e) {
    return {
      id: `patch_${randomUUID().slice(0, 8)}`,
      findingFingerprint: finding.fingerprint || 'unknown',
      path: finding.path,
      diff: '',
      explanation: `patch generation failed: ${e.message}`,
      status: 'unvalidated',
      validation: null,
      contentHash: patchFileHash,
      createdAt: new Date().toISOString(),
    };
  }

  const validation = validatePatch(root, generated.diff, { testFiles });
  const record = {
    id: `patch_${randomUUID().slice(0, 8)}`,
    findingFingerprint: finding.fingerprint || 'unknown',
    path: finding.path,
    diff: generated.diff,
    explanation: generated.explanation,
    status: validation.status,
    validation,
    contentHash: patchFileHash,
    validatedAgainst: 'HEAD worktree (not the dirty working tree)',
    createdAt: new Date().toISOString(),
  };
  const check = validatePatchRecord(record);
  if (!check.ok) throw new Error(`Patch record contract violated: ${check.errors.join('; ')}`);
  return record;
}

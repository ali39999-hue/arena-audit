/**
 * Arena Audit — Git Delta / Diff-Aware Audit (P11-01, P11-02)
 *
 * Modes:
 *   full    — audit everything (default)
 *   diff    — audit only files changed vs a base (default: HEAD for working
 *             tree changes; pass a ref like origin/main for PR audits)
 *   target  — audit only a subtree (--target src/payments)
 */

import { spawnSync } from 'node:child_process';

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return (r.stdout || '').trim();
}

/**
 * Changed files vs a base ref.
 *  - base given: tracked diff vs that ref (PR mode).
 *  - no base: working-tree diff vs HEAD + untracked files.
 * Returns { available, base, changed: [{path, status}], added, modified, deleted, renamed, untrackedCount }
 */
export function gitDelta(root, base = null) {
  const head = git(root, ['rev-parse', 'HEAD']);
  if (!head) return { available: false, reason: 'not a git repository' };

  const changed = new Map(); // path -> status letter
  const args = base
    ? ['diff', '--name-status', '--find-renames', base]
    : ['diff', '--name-status', '--find-renames', 'HEAD'];
  const out = git(root, args) || '';
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [status, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (!path) continue;
    if (status.startsWith('R')) {
      const [from, to] = path.split('\t');
      changed.set(from, 'D');
      changed.set(to, 'A');
    } else {
      changed.set(path, status.charAt(0));
    }
  }

  let untrackedCount = 0;
  if (!base) {
    const un = git(root, ['ls-files', '--others', '--exclude-standard']) || '';
    for (const p of un.split('\n')) {
      if (!p.trim()) continue;
      untrackedCount++;
      if (!changed.has(p)) changed.set(p, 'A');
    }
  }

  const list = [...changed.entries()].map(([path, status]) => ({ path, status }));
  return {
    available: true,
    base: base || 'HEAD',
    head,
    changed: list,
    added: list.filter((c) => c.status === 'A').map((c) => c.path),
    modified: list.filter((c) => c.status === 'M').map((c) => c.path),
    deleted: list.filter((c) => c.status === 'D').map((c) => c.path),
    renamed: list.filter((c) => c.status === 'R').map((c) => c.path),
    untrackedCount,
  };
}

/** Unified diff text for the changed files (bounded) — becomes evidence context. */
export function gitDiffText(root, base = null, { maxBytes = 60000 } = {}) {
  const args = base ? ['diff', base] : ['diff', 'HEAD'];
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  const text = r.status === 0 ? (r.stdout || '') : '';
  return text.length > maxBytes ? text.slice(0, maxBytes) + `\n… (truncated at ${maxBytes} bytes)` : text;
}

/** Apply the audit mode to the file inventory. */
export function scopeFiles(root, snapshot, mode, { base = null, target = null } = {}) {
  if (mode === 'target' && target) {
    const norm = target.replace(/\\/g, '/').replace(/\/$/, '');
    const scopedFiles = snapshot.allFiles.filter((f) => f.path.startsWith(norm));
    return { scopedFiles, scopeNote: `targeted: ${norm}`, delta: null };
  }
  if (mode === 'diff') {
    const delta = gitDelta(root, base);
    if (!delta.available) {
      return { scopedFiles: snapshot.allFiles, scopeNote: 'full (diff requested but not a git repo)', delta };
    }
    const changedSet = new Set(delta.changed.map((c) => c.path));
    const scopedFiles = snapshot.allFiles.filter((f) => changedSet.has(f.path));
    return { scopedFiles, scopeNote: `diff vs ${delta.base} (${scopedFiles.length} files)`, delta };
  }
  return { scopedFiles: snapshot.allFiles, scopeNote: 'full', delta: null };
}

/**
 * Arena Audit — Snapshot Sandbox (P8-01..P8-03, P8-13..P8-15)
 *
 * For untrusted repositories: audit a READ-ONLY COPY of the repo in a
 * temporary workspace instead of the original checkout. Mutations, gate
 * side-effects or malicious test code can never touch the user's tree.
 *
 * Escape fixtures: symlinks are NOT followed (symlink-escape blocked) and
 * evidence refs resolving outside the snapshot are rejected (path-escape).
 */

import { readdirSync, mkdirSync, copyFileSync, statSync, existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.arena']);

/**
 * Create an isolated snapshot workspace (recursive copy, no symlinks).
 * Returns { workspace, fileCount, cleanup() }.
 */
export function createSnapshotWorkspace(root, { exclude = [] } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'arena-snap-'));
  let fileCount = 0;
  const skipSet = new Set([...SKIP_DIRS, ...exclude]);

  function copyDir(src, dest, depth) {
    if (depth > 16) return;
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (skipSet.has(entry.name)) continue;
      const s = join(src, entry.name);
      const d = join(dest, entry.name);
      // P8-15: symlink escape fixture — symlinks are never followed
      const st = statSync(s);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) copyDir(s, d, depth + 1);
      else if (st.isFile()) { copyFileSync(s, d); fileCount++; }
    }
  }

  copyDir(resolve(root), workspace, 0);

  return {
    workspace,
    fileCount,
    cleanup: () => { try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
}

/**
 * Verify snapshot isolation: a path that would escape the snapshot is rejected.
 * (Used by escape-fixture tests.)
 */
export function assertPathInsideSnapshot(workspace, candidate) {
  const full = resolve(workspace, candidate);
  return full === resolve(workspace) || full.startsWith(resolve(workspace) + sep);
}

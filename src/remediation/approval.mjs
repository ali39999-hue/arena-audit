/**
 * Arena Audit — Human Approval Workflow (P13-08)
 *
 * Patches are suggestions. The engine NEVER applies one. A human either runs
 * `git apply <file>` themselves after approving, or rejects with a reason —
 * both recorded audit-style (who / when / why) in remediation.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function patchesFile(outDir) {
  return join(outDir, 'remediation.json');
}

export function loadRemediation(outDir) {
  const p = patchesFile(outDir);
  if (!existsSync(p)) return { note: null, patches: [] };
  const parsed = JSON.parse(readFileSync(p, 'utf-8'));
  return { note: parsed.note || null, patches: parsed.patches || [] };
}

function saveRemediation(outDir, data) {
  writeFileSync(patchesFile(outDir), JSON.stringify(data, null, 2), 'utf-8');
}

export function listPatches(outDir) {
  return loadRemediation(outDir).patches;
}

export function getPatch(outDir, id) {
  return listPatches(outDir).find((p) => p.id === id) || null;
}

/**
 * Record a human approval. Fails on unknown id or double-approval.
 * Returns { patch, warning? } — warning when the patch is not "recommended".
 */
export function approvePatch(outDir, id, { approver = 'unknown', force = false } = {}) {
  const data = loadRemediation(outDir);
  const patch = data.patches.find((p) => p.id === id);
  if (!patch) throw new Error(`unknown patch id: ${id}`);
  if (patch.approval?.status === 'approved') throw new Error(`patch ${id} is already approved`);

  let warning = null;
  const conf = patch.confidence?.confidence ?? 0;
  if (!patch.confidence?.recommended) {
    warning = `confidence ${conf} is below the recommended bar or hard gates are red — pass --force to approve anyway`;
    if (!force) return { patch, warning, blocked: true };
  }

  patch.approval = { status: 'approved', approver, at: new Date().toISOString(), confidenceAtApproval: conf, ...(warning ? { forced: true } : {}) };
  saveRemediation(outDir, data);
  return { patch, warning };
}

export function rejectPatch(outDir, id, { reason = 'no reason given', approver = 'unknown' } = {}) {
  const data = loadRemediation(outDir);
  const patch = data.patches.find((p) => p.id === id);
  if (!patch) throw new Error(`unknown patch id: ${id}`);
  patch.approval = { status: 'rejected', reason, approver, at: new Date().toISOString() };
  saveRemediation(outDir, data);
  return patch;
}

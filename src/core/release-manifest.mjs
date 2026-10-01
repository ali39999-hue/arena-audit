/**
 * Arena Audit — Release Manifest (P0-08) & Reproducibility Manifest (P0-10)
 *
 * release-manifest.json: canonical machine-readable release identity.
 * Reproducibility manifest: attached to every audit run so any run can be
 * re-executed deterministically (same inputs → same outputs).
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENGINE_SCHEMA_VERSION } from './schemas.mjs';
import { CAPABILITY_REGISTRY } from './capability-status.mjs';

/** Canonical JSON hash (stable key ordering at every nesting level). */
export function canonicalHash(obj) {
  const stable = JSON.stringify(obj, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  });
  return createHash('sha256').update(stable).digest('hex');
}

/**
 * Reproducibility manifest for an audit run.
 * configHash binds the run configuration: re-running with the same config,
 * same commit and same deterministic capabilities must yield the same
 * detector findings, gate results and evidence hashes.
 */
export function buildReproducibilityManifest({ engineVersion, mode, sandbox, concurrency, policyProfile, goal, commit, seed = null }) {
  const config = { mode, sandbox, concurrency, policyProfile, goal, seed };
  return {
    schemaVersion: ENGINE_SCHEMA_VERSION,
    engineVersion,
    configHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
    config,
    commit: commit || null,
    deterministic: {
      machineGates: true,
      detectors: true,
      evidenceHashes: true,
      note: 'LLM specialist/verifier outputs are NOT deterministic; their inputs (prompts, evidence) are bound above.',
    },
  };
}

/** Build the release manifest from the current checkout. */
export function buildReleaseManifest(root, { commit = null } = {}) {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
  const caps = CAPABILITY_REGISTRY.map(({ id, status }) => ({ id, status }));

  const unitDir = resolve(root, 'tests', 'unit');
  const testFiles = existsSyncSafe(unitDir)
    ? readdirSync(unitDir).filter((f) => f.endsWith('.test.mjs')).length
    : 0;

  return {
    schemaVersion: ENGINE_SCHEMA_VERSION,
    name: pkg.name,
    version: pkg.version,
    commit,
    node: process.version,
    capabilities: caps,
    counts: {
      implemented: caps.filter((c) => c.status === 'IMPLEMENTED').length,
      experimental: caps.filter((c) => c.status === 'EXPERIMENTAL').length,
      unverified: caps.filter((c) => c.status === 'IMPLEMENTED-BUT-UNVERIFIED').length,
      planned: caps.filter((c) => c.status === 'PLANNED').length,
    },
    testFiles,
    manifestHash: canonicalHash({ version: pkg.version, schemaVersion: ENGINE_SCHEMA_VERSION, capabilities: caps }),
    generatedAt: new Date().toISOString(),
  };
}

function existsSyncSafe(p) { try { return existsSync(p); } catch { return false; } }

export function writeReleaseManifest(root, { commit = null } = {}) {
  const manifest = buildReleaseManifest(root, { commit });
  const out = resolve(root, 'release-manifest.json');
  writeFileSync(out, JSON.stringify(manifest, null, 2), 'utf-8');
  return { path: out, manifest };
}

/**
 * Arena Audit — Artifact Store (DW-09)
 *
 * Every artifact: { id, type, producerTask, runId, hash, metadata, createdAt }.
 * Content is stored under artifacts/ and integrity-verifiable by hash.
 * Artifact dependencies are explicit.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const ARTIFACT_TYPES = [
  'source-snapshot', 'evidence', 'scanner-result', 'semantic-graph', 'finding',
  'verification', 'reproduction', 'patch', 'test-result', 'report',
  'benchmark', 'trace',
];

export class ArtifactStore {
  constructor(runDir) {
    this.dir = join(runDir, 'artifacts');
    this.index = new Map(); // id → record
  }

  register({ type, producerTask, runId, content, metadata = {}, dependsOn = [] }) {
    if (!ARTIFACT_TYPES.includes(type)) {
      throw new Error(`Unknown artifact type: ${type} (allowed: ${ARTIFACT_TYPES.join(', ')})`);
    }
    const id = `art_${randomUUID().slice(0, 10)}`;
    const hash = createHash('sha256').update(JSON.stringify(content) || '').digest('hex');

    const record = {
      id, type, producerTask, runId, hash, metadata,
      dependsOn, createdAt: new Date().toISOString(),
    };

    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify({ ...record, content }, null, 2), 'utf-8');
    this.index.set(id, { ...record, content });
    return { ...record };
  }

  get(id) {
    if (this.index.has(id)) return this.index.get(id);
    const p = join(this.dir, `${id}.json`);
    try {
      const rec = JSON.parse(readFileSync(p, 'utf-8'));
      this.index.set(rec.id, rec);
      return rec;
    } catch {
      return null;
    }
  }

  /** Recompute content hash and compare — integrity validation. */
  verifyIntegrity(id) {
    const rec = this.get(id);
    if (!rec) return { ok: false, reason: 'not found' };
    const hash = createHash('sha256').update(JSON.stringify(rec.content) || '').digest('hex');
    return { ok: hash === rec.hash, expected: rec.hash, actual: hash };
  }

  list(type = null) {
    return [...this.index.values()].filter((a) => !type || a.type === type);
  }
}

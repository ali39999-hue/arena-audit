/**
 * Arena Audit — Evidence Engine (P2-01..P2-09)
 *
 * The spine of the engine. Every assertion must anchor to evidence:
 * file, exact lines, content hash, provenance. If the hash no longer
 * matches the file, the finding becomes stale — never silently valid.
 *
 * "No Evidence ≠ Pass."
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** P2-03 — Content hashing. */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** Parse a "path:line" or "path:startLine-endLine" reference. */
export function parseLocation(ref) {
  const m = String(ref || '').match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!m) return { file: String(ref || ''), startLine: null, endLine: null };
  return {
    file: m[1],
    startLine: m[2] ? parseInt(m[2], 10) : null,
    endLine: m[3] ? parseInt(m[3], 10) : (m[2] ? parseInt(m[2], 10) : null),
  };
}

/** P2-02 — Source locator: resolve path:line into a hashed excerpt with context. */
export function locateSource(root, ref, { contextLines = 4 } = {}) {
  const { file, startLine, endLine } = parseLocation(ref);
  // Line-anchoring integrity (P2 gate): line 0 and lines beyond EOF are
  // invalid anchors — a finding citing them can never be "verified".
  if (startLine !== null && (startLine < 1 || (endLine !== null && endLine < startLine))) {
    return { status: 'invalid_line', file, startLine, endLine };
  }
  const full = resolve(root, file);
  if (!existsSync(full)) {
    return { status: 'missing_file', file, startLine, endLine };
  }
  let content;
  try {
    content = readFileSync(full, 'utf-8');
  } catch {
    return { status: 'unreadable', file, startLine, endLine };
  }
  const lines = content.split(/\r?\n/);
  if (startLine !== null && startLine > lines.length) {
    return { status: 'invalid_line', file, startLine, endLine, fileLineCount: lines.length };
  }
  const lo = Math.max(1, (startLine || 1) - contextLines);
  const hi = Math.min(lines.length, (endLine || startLine || 1) + contextLines);
  const excerptLines = [];
  for (let i = lo; i <= hi; i++) excerptLines.push(`${i}| ${lines[i - 1]}`);
  const excerpt = excerptLines.join('\n');
  const excerptHash = sha256(lines.slice((startLine || 1) - 1, endLine || startLine || 1).join('\n'));
  return {
    status: 'ok',
    file,
    startLine: startLine || 1,
    endLine: endLine || startLine || 1,
    fileLineCount: lines.length,
    excerpt,
    contentHash: excerptHash,
    fileHash: sha256(content),
  };
}

/** P2-08 — Stale evidence detection: stored hash vs current file content. */
export function isStale(root, evidence) {
  if (!evidence || evidence.type !== 'source') return false;
  const full = resolve(root, evidence.path);
  if (!existsSync(full)) return true;
  try {
    const lines = readFileSync(full, 'utf-8').split(/\r?\n/);
    const slice = lines.slice((evidence.startLine || 1) - 1, evidence.endLine || evidence.startLine || 1).join('\n');
    return sha256(slice) !== evidence.contentHash;
  } catch {
    return true;
  }
}

/**
 * P2-05 — Evidence Store: collects evidence, assigns ids, exposes provenance.
 */
export class EvidenceStore {
  constructor(root, commit = null) {
    this.root = root;
    this.commit = commit;
    this.map = new Map();
  }

  /** Add source evidence from a path:line ref. Returns the evidence object (or an error record). */
  addSource(ref, provenance, opts) {
    const located = locateSource(this.root, ref, opts);
    const ev = located.status === 'ok'
      ? {
          id: `ev_${randomUUID().slice(0, 8)}`,
          type: 'source',
          commit: this.commit || null,
          path: located.file,
          startLine: located.startLine,
          endLine: located.endLine,
          contentHash: located.contentHash,
          excerpt: located.excerpt,
          fileHash: located.fileHash,
          provenance,
          createdAt: new Date().toISOString(),
        }
      : {
          id: `ev_${randomUUID().slice(0, 8)}`,
          type: 'error',
          status: located.status,
          ref,
          provenance,
          createdAt: new Date().toISOString(),
        };
    this.map.set(ev.id, ev);
    return ev;
  }

  addTool(tool, summary, details) {
    const ev = {
      id: `ev_${randomUUID().slice(0, 8)}`,
      type: 'scanner',
      tool,
      summary,
      details,
      createdAt: new Date().toISOString(),
    };
    this.map.set(ev.id, ev);
    return ev;
  }

  addCommand(command, output) {
    const ev = {
      id: `ev_${randomUUID().slice(0, 8)}`,
      type: 'command',
      command,
      output: String(output || '').slice(0, 8000),
      createdAt: new Date().toISOString(),
    };
    this.map.set(ev.id, ev);
    return ev;
  }

  get(id) { return this.map.get(id); }

  /** Resolve evidenceRefs → evidence objects for a verifier context (P2-06). */
  resolve(refs) {
    return (refs || []).map((r) => this.get(r)).filter(Boolean);
  }

  /** Serialize the full store for the audit-run output. */
  toJSON() {
    return [...this.map.values()];
  }
}

/** P2-07 — Provenance chain for one finding. */
export function provenanceFor(agentName, model, provider) {
  return { kind: 'agent', name: agentName, model, provider, at: new Date().toISOString() };
}

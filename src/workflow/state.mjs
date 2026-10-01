/**
 * Arena Audit — Workflow State Store & Checkpoint System (DW-08, DW-19)
 *
 * Local-first durable state under:
 *   .arena/workflows/<run-id>/
 *     workflow.json  tasks.json  events.jsonl  decisions.json
 *     telemetry.json  checkpoints/  artifacts/
 *
 * A killed process must resume safely: checkpoint → validate → restore.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

function safeWrite(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, 'utf-8');
  try {
    writeFileSync(path, data, 'utf-8');
  } finally {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
  }
}

export class WorkflowStateStore {
  constructor(stateRoot, runId) {
    this.runDir = join(stateRoot, runId);
    this.runId = runId;
  }

  init() {
    mkdirSync(join(this.runDir, 'checkpoints'), { recursive: true });
    mkdirSync(join(this.runDir, 'artifacts'), { recursive: true });
    if (!existsSync(join(this.runDir, 'workflow.json'))) {
      safeWrite(join(this.runDir, 'workflow.json'), '{}');
      safeWrite(join(this.runDir, 'tasks.json'), '[]');
      safeWrite(join(this.runDir, 'decisions.json'), '[]');
      safeWrite(join(this.runDir, 'telemetry.json'), '{}');
    }
    if (!existsSync(join(this.runDir, 'events.jsonl'))) {
      writeFileSync(join(this.runDir, 'events.jsonl'), '', 'utf-8');
    }
  }

  exists() { return existsSync(this.runDir); }

  saveWorkflow(workflow, run) {
    safeWrite(join(this.runDir, 'workflow.json'), JSON.stringify({ workflow, run }, null, 2));
  }

  loadWorkflow() {
    return JSON.parse(readFileSync(join(this.runDir, 'workflow.json'), 'utf-8'));
  }

  saveTasks(tasks) {
    safeWrite(join(this.runDir, 'tasks.json'), JSON.stringify(tasks, null, 2));
  }

  loadTasks() {
    return JSON.parse(readFileSync(join(this.runDir, 'tasks.json'), 'utf-8'));
  }

  appendEvent(event) {
    appendFileSync(join(this.runDir, 'events.jsonl'), JSON.stringify(event) + '\n', 'utf-8');
  }

  loadEvents() {
    const p = join(this.runDir, 'events.jsonl');
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  saveDecisions(decisions) {
    safeWrite(join(this.runDir, 'decisions.json'), JSON.stringify(decisions, null, 2));
  }

  loadDecisions() {
    return JSON.parse(readFileSync(join(this.runDir, 'decisions.json'), 'utf-8'));
  }

  saveTelemetry(telemetry) {
    safeWrite(join(this.runDir, 'telemetry.json'), JSON.stringify(telemetry, null, 2));
  }

  // ── Checkpoints (DW-08.02..08.05) ─────────────────────────────────────────

  checkpoint(state) {
    const stateHash = createHash('sha256')
      .update(JSON.stringify(state.tasks))
      .digest('hex');
    const cp = {
      id: `cp_${Date.now().toString(36)}_${state.tasks.length}`,
      stateHash,
      graphVersion: state.graphVersion,
      tasks: state.tasks,
      counters: state.counters,
      createdAt: new Date().toISOString(),
    };
    safeWrite(join(this.runDir, 'checkpoints', `${cp.id}.json`), JSON.stringify(cp, null, 2));
    safeWrite(join(this.runDir, 'latest-checkpoint.json'), JSON.stringify(cp, null, 2));
    return cp;
  }

  latestCheckpoint() {
    const p = join(this.runDir, 'latest-checkpoint.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8'));
  }

  validateCheckpoint(cp) {
    if (!cp || !cp.tasks) return { ok: false, reason: 'missing tasks' };
    const hash = createHash('sha256').update(JSON.stringify(cp.tasks)).digest('hex');
    return { ok: hash === cp.stateHash, reason: hash === cp.stateHash ? null : 'state hash mismatch' };
  }

  listCheckpoints() {
    const dir = join(this.runDir, 'checkpoints');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  }
}

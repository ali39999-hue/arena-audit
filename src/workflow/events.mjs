/**
 * Arena Audit — Event Bus (DW-07)
 *
 * Append-only workflow event log with in-memory fan-out and JSONL persistence.
 * Every event carries timestamp, runId, taskId, actor, correlationId, payload.
 * Handlers must be idempotent (replay-safe).
 */

import { createEvent } from './schemas.mjs';

export const EVENT_TYPES = [
  'workflow.started', 'workflow.paused', 'workflow.resumed', 'workflow.completed', 'workflow.failed',
  'task.created', 'task.ready', 'task.started', 'task.completed', 'task.failed',
  'task.cancelled', 'task.retrying', 'task.skipped',
  'finding.created', 'finding.verified', 'finding.refuted', 'finding.regressed',
  'evidence.created', 'evidence.invalidated',
  'artifact.created',
  'decision.created', 'replan.requested',
  'human.approval.requested', 'human.approval.completed',
  'budget.exceeded',
];

export class EventBus {
  constructor({ runId, persistence = null } = {}) {
    this.runId = runId;
    this.seq = 0;
    this.log = [];          // append-only
    this.subscribers = [];  // [{types:Set|null(all), handler}]
    this.persistence = persistence; // { append(event) }
  }

  emit(type, { taskId = null, actor = 'engine', payload = {}, correlationId = null } = {}) {
    const event = createEvent({ type, runId: this.runId, taskId, actor, correlationId, payload });
    this.seq += 1;
    event.seq = this.seq;
    this.log.push(event);
    if (this.persistence) {
      try { this.persistence.append(event); } catch { /* persistence failure must not kill the run */ }
    }
    for (const sub of this.subscribers) {
      if (sub.types && !sub.types.has(type)) continue;
      try { sub.handler(event); } catch { /* subscriber isolation */ }
    }
    return event;
  }

  /** Adopt a persisted event (resume path) without re-appending to storage. */
  ingest(event) {
    this.log.push(event);
    if (event.seq > this.seq) this.seq = event.seq;
    return event;
  }

  subscribe(types, handler) {
    const sub = { types: types ? new Set(types) : null, handler };
    this.subscribers.push(sub);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== sub);
    };
  }

  /** Replay historical events through a handler (idempotent handlers only). */
  replay(handler) {
    for (const e of this.log) handler(e);
  }

  all() {
    return [...this.log];
  }

  byTask(taskId) {
    return this.log.filter((e) => e.taskId === taskId);
  }

  count(type) {
    return this.log.filter((e) => e.type === type).length;
  }
}

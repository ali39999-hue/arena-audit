/**
 * Arena Audit — Dynamic Workflow Runtime: Schemas & Task State Machine (DW-01)
 *
 * Domain model for workflows, runs, tasks, artifacts, events, decisions and
 * checkpoints. All state transitions are legal-transition-listed; illegal
 * transitions fail deterministically.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Task state machine (DW-01.02)
// ---------------------------------------------------------------------------
export const TASK_STATES = [
  'PENDING', 'READY', 'RUNNING', 'BLOCKED', 'WAITING_FOR_HUMAN',
  'SUCCEEDED', 'FAILED', 'RETRYING', 'CANCELLED', 'SKIPPED', 'NEEDS_REPLAN',
];

export const TASK_TRANSITIONS = {
  PENDING: ['READY', 'CANCELLED', 'SKIPPED', 'BLOCKED', 'WAITING_FOR_HUMAN'],
  READY: ['RUNNING', 'CANCELLED', 'SKIPPED', 'NEEDS_REPLAN'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'RETRYING', 'CANCELLED', 'NEEDS_REPLAN'],
  BLOCKED: ['READY', 'CANCELLED', 'SKIPPED'],
  WAITING_FOR_HUMAN: ['READY', 'SUCCEEDED', 'CANCELLED', 'SKIPPED'],
  RETRYING: ['READY', 'CANCELLED', 'FAILED'],
  FAILED: ['RETRYING', 'CANCELLED', 'NEEDS_REPLAN'],
  SUCCEEDED: [],
  CANCELLED: [],
  SKIPPED: [],
  NEEDS_REPLAN: ['PENDING', 'CANCELLED', 'SKIPPED'],
};

export function assertTaskTransition(from, to) {
  const allowed = TASK_TRANSITIONS[from];
  if (!allowed) throw new Error(`Unknown task state: ${from}`);
  if (!allowed.includes(to)) {
    throw new Error(`Illegal task transition ${from} → ${to}`);
  }
  return true;
}

export const WORKFLOW_STATUSES = [
  'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED', 'BUDGET_EXCEEDED',
];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export function createWorkflow({ goal, policy = null, budget = null, trigger = 'manual' }) {
  return {
    id: `wf_${randomUUID().slice(0, 8)}`,
    version: 1,
    trigger,
    goal,
    policy: policy || {},
    budget: budget || {},
    createdAt: new Date().toISOString(),
  };
}

export function createWorkflowRun(workflow, { root, graphVersion = 1 } = {}) {
  return {
    runId: `run_${randomUUID().slice(0, 12)}`,
    workflowId: workflow.id,
    root,
    status: 'RUNNING',
    graphVersion,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

export function createTask({ capability, title, input = {}, priority = 3, dependsOn = [], requiresApproval = false, maxRetries = 2, allowedTools = null, timeoutMs = 300000 }) {
  return {
    id: `task_${randomUUID().slice(0, 10)}`,
    capability,
    title: title || capability,
    status: 'PENDING',
    priority, // 1 = highest
    input,
    output: null,
    dependsOn,
    requiresApproval,
    approval: null,
    allowedTools,
    timeoutMs,
    attempts: 0,
    maxRetries,
    agent: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
  };
}

export function createDecision({ reason, evidenceRefs = [], outcome, taskId = null }) {
  return {
    id: `dec_${randomUUID().slice(0, 8)}`,
    reason,
    evidenceRefs,
    outcome, // e.g. created_tasks | skipped | requested_human | abort
    taskId,
    at: new Date().toISOString(),
  };
}

export function createEvent({ type, runId, taskId = null, actor = 'engine', correlationId = null, payload = {} }) {
  return {
    seq: 0, // assigned by event log
    id: `evt_${randomUUID().slice(0, 10)}`,
    type,
    runId,
    taskId,
    actor,
    correlationId: correlationId || runId,
    payload,
    timestamp: new Date().toISOString(),
  };
}

export function createCheckpoint({ stateHash, tasks, graphVersion, counters }) {
  return {
    id: `cp_${randomUUID().slice(0, 8)}`,
    stateHash,
    graphVersion,
    tasks,
    counters,
    createdAt: new Date().toISOString(),
  };
}

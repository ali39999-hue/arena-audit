/**
 * Arena Audit — Planner & Re-Planner (DW-06)
 *
 * Initial planning: user goal + repository snapshot + capabilities + policy
 *   → initial task DAG.
 *
 * Runtime re-planning: after each important task completes,
 *   result + evidence + policy → NEW TASKS | SKIP | PRIORITY CHANGE | HUMAN GATE.
 *
 * Example (from the roadmap):
 *   security finding HIGH → create verification + reproduction
 *   reproduced → create remediation + regression
 *   refuted → skip remediation
 *   critical / autonomous patch → require human approval
 */

import { createTask, createDecision } from './schemas.mjs';

const AUDIT_CAPABILITIES = [
  { capability: 'machine-gates', title: 'Run machine quality gates', priority: 1 },
  { capability: 'semantic-analysis', title: 'Build semantic inventory (AST)', priority: 2 },
  { capability: 'security-audit', title: 'Security audit (detectors)', priority: 2 },
  { capability: 'correctness-audit', title: 'Correctness audit (detectors)', priority: 2 },
  { capability: 'architecture-audit', title: 'Architecture audit (detectors)', priority: 3 },
  { capability: 'testing-audit', title: 'Testing audit (detectors)', priority: 3 },
  { capability: 'performance-audit', title: 'Performance audit (detectors)', priority: 3 },
];

/**
 * Initial plan for the default 'audit' goal.
 * Returns array of task specs (not yet DAG instances).
 */
export function planInitial({ goal = 'audit', snapshot, policyProfile = 'OWASP-Top10' }) {
  const tasks = [];

  tasks.push(createTask({
    capability: 'repository-intelligence',
    title: 'Repository discovery',
    priority: 1,
    maxRetries: 1,
  }));

  const discovery = tasks[0].id;

  for (const spec of AUDIT_CAPABILITIES) {
    tasks.push(createTask({
      ...spec,
      dependsOn: [discovery],
      input: { policyProfile },
    }));
  }

  // Verification waits for ALL audits
  const auditIds = tasks.slice(1).map((t) => t.id);
  tasks.push(createTask({
    capability: 'verification',
    title: 'Evidence-anchored adversarial verification',
    priority: 1,
    dependsOn: auditIds,
  }));

  // Policy gate then reporting
  const verification = tasks[tasks.length - 1].id;
  tasks.push(createTask({
    capability: 'policy-evaluation',
    title: `Policy evaluation (${policyProfile})`,
    priority: 2,
    dependsOn: [verification],
    input: { policyProfile },
  }));
  const policyTask = tasks[tasks.length - 1].id;
  tasks.push(createTask({
    capability: 'reporting',
    title: 'Assemble final report',
    priority: 2,
    dependsOn: [policyTask],
    input: { policyProfile },
  }));

  void goal;
  return tasks;
}

/**
 * Re-planning after a task completes.
 * Returns { newTasks, decisions }.
 */
export function replan({ task, result = {}, findings = [], policy = {}, budget = null }) {
  const newTasks = [];
  const decisions = [];
  const cap = task.capability;

  // After verification: branch on verified/refuted severity
  if (cap === 'verification') {
    const outFindings = result.findings || [];
    const verifiedHigh = outFindings.filter((f) => f.status === 'verified' && (f.severity === 'high' || f.severity === 'critical'));
    const verifiedAny = outFindings.filter((f) => f.status === 'verified');
    const refuted = outFindings.filter((f) => f.status === 'refuted');

    if (verifiedHigh.length > 0) {
      newTasks.push(createTask({
        capability: 'reproduction',
        title: `Reproduce ${verifiedHigh.length} verified high finding(s)`,
        priority: 1,
        dependsOn: [task.id],
        input: { policyProfile: policy.profile },
      }));
      decisions.push(createDecision({
        reason: `${verifiedHigh.length} verified high finding(s) — reproduction required`,
        outcome: 'created_tasks',
        taskId: task.id,
      }));
    }

    if (verifiedAny.some((f) => f.severity === 'critical')) {
      const approval = createTask({
        capability: 'human-approval',
        title: 'Human approval required: critical finding',
        priority: 1,
        dependsOn: [task.id],
        requiresApproval: true,
      });
      newTasks.push(approval);
      decisions.push(createDecision({
        reason: 'critical severity requires human approval',
        outcome: 'requested_human',
        taskId: task.id,
      }));
    }

    if (refuted.length > 0) {
      decisions.push(createDecision({
        reason: `${refuted.length} refuted finding(s) — remediation skipped for them`,
        outcome: 'skipped',
        taskId: task.id,
      }));
    }
  }

  // After reproduction: reproduced → remediation
  if (cap === 'reproduction') {
    if (result.reproduced) {
      newTasks.push(createTask({
        capability: 'remediation',
        title: 'Generate suggested patches (worktree validated)',
        priority: 1,
        dependsOn: [task.id],
      }));
      decisions.push(createDecision({
        reason: 'finding reproduced — remediation suggested',
        outcome: 'created_tasks',
        taskId: task.id,
      }));
    } else {
      decisions.push(createDecision({
        reason: 'not reproducible — remediation not created (not_reproducible ≠ refuted)',
        outcome: 'skipped',
        taskId: task.id,
      }));
    }
  }

  // After remediation: regression + human approval for applied patches
  if (cap === 'remediation' && result.validated) {
    newTasks.push(createTask({
      capability: 'regression',
      title: 'Regression audit on remediated tree',
      priority: 1,
      dependsOn: [task.id],
    }));
    newTasks.push(createTask({
      capability: 'human-approval',
      title: 'Human approval required: apply suggested patch',
      priority: 1,
      dependsOn: [task.id],
      requiresApproval: true,
    }));
    decisions.push(createDecision({
      reason: 'validated patch — regression audit + human approval required before any apply',
      outcome: 'created_tasks',
      taskId: task.id,
    }));
  }

  // Budget-aware scope reduction
  if (budget && budget.exceeded) {
    decisions.push(createDecision({
      reason: `budget exceeded on ${budget.exceeded.dimension} — reduced-scope replanning`,
      outcome: 'reduced_scope',
      taskId: task.id,
    }));
  }

  return { newTasks, decisions };
}

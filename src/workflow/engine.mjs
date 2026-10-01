/**
 * Arena Audit — Dynamic Workflow Engine (DW-05, DW-08, DW-10..DW-14)
 *
 * Domain-neutral orchestration core:
 *   Planner → Dynamic Task DAG → Scheduler (bounded, priority) →
 *   Capabilities / Agents / Tools → Evidence → Decision → Re-plan → …
 *
 * Guarantees:
 *  - bounded concurrency (never unbounded Promise.all)
 *  - legal task transitions only
 *  - tool permission enforcement per task
 *  - checkpoint / resume (a killed run continues safely)
 *  - budget enforcement with soft warnings and hard stop
 *  - human approval gates (WAITING_FOR_HUMAN)
 *  - failure classification with retry/fallback/replan/abort
 */

import { DynamicDag } from './dag.mjs';
import { EventBus } from './events.mjs';
import { Budget } from './budget.mjs';
import { WorkflowStateStore } from './state.mjs';
import { ArtifactStore } from './artifacts.mjs';
import { CapabilityRegistry, assertToolsAllowed, TOOL_REGISTRY } from './capabilities.mjs';
import { AgentRegistry } from './agents.mjs';
import { planInitial, replan } from './planner.mjs';
import { evaluateCondition } from './conditions.mjs';
import { classifyFailure, recoveryStrategyFor } from './failures.mjs';
import { createWorkflow, createWorkflowRun, WORKFLOW_STATUSES } from './schemas.mjs';
import { EvidenceStore } from '../evidence/evidence-store.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class WorkflowEngine {
  constructor({ root, goal = 'audit', stateDir = null, maxConcurrency = 4, budgetLimits = {}, llm = null, policyProfile = 'OWASP-Top10', testHook = null, runId = null } = {}) {
    this.root = root;
    this.goal = goal;
    this.maxConcurrency = maxConcurrency;
    this.llm = llm;
    this.policyProfile = policyProfile;
    this.testHook = testHook; // testHook(engine, completedCount) — for deterministic tests

    this.capabilities = new CapabilityRegistry();
    this.agentRegistry = new AgentRegistry();
    this.budget = new Budget(budgetLimits);
    this.dag = new DynamicDag();
    this.findings = [];
    this.decisions = [];
    this.completedCount = 0;
    this.status = 'RUNNING';
    this.evidence = new EvidenceStore(root);
    this.gateResults = [];
    this.patches = [];
    this.lastDecision = null;

    if (runId) {
      // resume path — populated by loadState()
      this.runId = runId;
      this.workflow = null;
      this.run = null;
      this.state = new WorkflowStateStore(stateDir, runId);
      this.events = new EventBus({ runId, persistence: { append: (e) => this.state.appendEvent(e) } });
      this.artifacts = new ArtifactStore(this.state.runDir);
      this._resumable = true;
    } else {
      this.workflow = createWorkflow({ goal, policy: { profile: policyProfile }, budget: budgetLimits });
      this.run = createWorkflowRun(this.workflow, { root });
      this.runId = this.run.runId;
      this.state = new WorkflowStateStore(stateDir, this.runId);
      this.events = new EventBus({ runId: this.runId, persistence: { append: (e) => this.state.appendEvent(e) } });
      this.artifacts = new ArtifactStore(this.state.runDir);
    }

    this._running = 0;
    this._driving = false;
    this._cancelled = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start() {
    if (this._resumable) throw new Error('This engine was constructed for resume; call resume() instead.');
    this.state.init();
    this.state.saveWorkflow(this.workflow, this.run);

    const initial = planInitial({ goal: this.goal, policyProfile: this.policyProfile });
    for (const t of initial) {
      this.dag.addTask(t);
      this.events.emit('task.created', { taskId: t.id, payload: { capability: t.capability, title: t.title } });
    }
    this.events.emit('workflow.started', { payload: { goal: this.goal, tasks: initial.length } });
    this._persist();

    await this._drive();
    return this._finalResult();
  }

  /** Resume a previously checkpointed (or crashed) run from disk. */
  async resume() {
    if (!this.state.exists()) throw new Error(`No workflow state found for run ${this.runId}`);
    const saved = this.state.loadWorkflow();
    this.workflow = saved.workflow;
    this.run = saved.run;
    this.run.status = 'RUNNING';

    const tasks = this.state.loadTasks();
    // Tasks that were RUNNING at crash time are safely reset to PENDING (re-executed).
    for (const t of tasks) {
      if (t.status === 'RUNNING') { t.status = 'PENDING'; t.startedAt = null; }
    }
    this.dag.restore(tasks);
    this.decisions = this.state.loadDecisions();
    this._hydrateFromTasks(tasks);
    // Replay persisted events so counters and history survive a crash
    for (const e of this.state.loadEvents()) this.events.ingest(e);
    this.events.emit('workflow.resumed', { payload: { tasks: tasks.length } });
    this._persist();
    await this._drive();
    return this._finalResult();
  }

  pause() {
    this.status = 'PAUSED';
    this.events.emit('workflow.paused', {});
    this._persist();
  }

  cancel() {
    this._cancelled = true;
    this.run.status = 'CANCELLED';
    for (const t of this.dag.tasks.values()) {
      if (['PENDING', 'READY', 'BLOCKED', 'WAITING_FOR_HUMAN', 'NEEDS_REPLAN'].includes(t.status)) {
        this.dag.transition(t, 'CANCELLED');
        this.events.emit('task.cancelled', { taskId: t.id });
      }
    }
    this.events.emit('workflow.failed', { payload: { reason: 'cancelled' } });
    this._persist();
  }

  // ── Human gates (DW-11) ────────────────────────────────────────────────────

  approveTask(taskId, { approver = 'unknown', note = null } = {}) {
    const task = this.dag.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    if (task.status !== 'WAITING_FOR_HUMAN' && !task.requiresApproval) {
      throw new Error(`Task ${taskId} is not waiting for human approval (status ${task.status})`);
    }
    task.approval = { status: 'approved', approver, note, at: new Date().toISOString() };
    if (task.status === 'WAITING_FOR_HUMAN') this.dag.transition(task, 'READY');
    this.events.emit('human.approval.completed', { taskId, actor: approver, payload: { approved: true } });
    this._persist();
    return task;
  }

  rejectTask(taskId, { reason = 'no reason given', approver = 'unknown' } = {}) {
    const task = this.dag.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    task.approval = { status: 'rejected', reason, approver, at: new Date().toISOString() };
    this.dag.transition(task, 'CANCELLED');
    this.events.emit('human.approval.completed', { taskId, actor: approver, payload: { approved: false, reason } });
    this._persist();
    return task;
  }

  // ── Core drive loop (DW-05 scheduler) ─────────────────────────────────────

  async _drive() {
    if (this._driving) return;
    this._driving = true;
    try {
      while (true) {
        if (this._cancelled) return;

        // Budget hard check
        const budgetCheck = this.budget.check();
        if (!budgetCheck.ok) {
          this.events.emit('budget.exceeded', { payload: budgetCheck.exceeded });
          this._reducedScopeReplan();
          this.run.status = 'BUDGET_EXCEEDED';
          for (const t of this.dag.tasks.values()) {
            if (['PENDING', 'READY', 'BLOCKED'].includes(t.status)) {
              this.dag.transition(t, 'CANCELLED');
            }
          }
          this._persist();
          return;
        }

        // Branch resolution (conditional deps → SKIP)
        const skipped = this.dag.resolveSkips(this._conditionContext());
        for (const t of skipped) this.events.emit('task.skipped', { taskId: t.id, payload: t.output });

        const ready = this.dag.readyTasks(this._conditionContext());

        if (ready.length === 0 && this._running === 0) {
          // Human gates may be pending — they don't block finalization of the rest
          const waiting = [...this.dag.tasks.values()].filter((t) => t.status === 'WAITING_FOR_HUMAN');
          if (waiting.length > 0) {
            this.run.status = 'PAUSED';
            this.events.emit('workflow.paused', { payload: { reason: 'human_gates', count: waiting.length } });
            this._persist();
            return; // resume via approveTask + _drive
          }
          return; // nothing left — workflow complete or failed
        }

        while (this._running < this.maxConcurrency && ready.length > 0) {
          const task = ready.shift();
          this._running += 1;
          this._executeTask(task)
            .catch(() => { /* failure already handled inside */ })
            .finally(() => {
              this._running -= 1;
              this.completedCount += 1;
              if (this.testHook) {
                try { this.testHook(this, this.completedCount); } catch (hookErr) {
                  // testHook throwing = simulated crash: persist and rethrow to stop the drive
                  this._crashError = hookErr;
                }
              }
            });
        }

        await sleep(10);
        if (this._crashError) {
          const err = this._crashError;
          this._crashError = null;
          this._persist();
          throw err;
        }
      }
    } finally {
      this._driving = false;
    }
  }

  async _executeTask(task) {
    try {
      // PENDING → READY → RUNNING (legal transition chain)
      this.dag.transition(task, 'READY');
      this.events.emit('task.ready', { taskId: task.id });
      this.dag.transition(task, 'RUNNING');
      task.startedAt = new Date().toISOString();
      this.events.emit('task.started', { taskId: task.id });

      const cap = this.capabilities.get(task.capability);
      if (!cap) {
        throw new Error(`Unknown capability: ${task.capability}`);
      }

      // Tool permission enforcement (STEP 6): no self-elevation
      assertToolsAllowed(task.allowedTools || this._defaultToolsFor(cap), cap.requiredTools);

      // Agent assignment (dynamic selection with fallback)
      if (!task.agent) {
        const agent = this.agentRegistry.selectAgent(cap.id);
        task.agent = agent ? { id: agent.id, provider: agent.provider, model: agent.model } : null;
      }

      const ctx = this._capabilityContext(task);
      // Timeout race: the timer is always cleared when the capability settles,
      // so completed tasks never leave a live 5-minute handle on the event loop.
      let timer;
      const result = await Promise.race([
        cap.run(ctx).finally(() => clearTimeout(timer)),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error(`task timed out after ${task.timeoutMs}ms`)), task.timeoutMs);
        }),
      ]);

      task.output = result?.data || result || {};
      this.dag.transition(task, 'SUCCEEDED');
      task.finishedAt = new Date().toISOString();
      this.budget.charge('tasksExecuted');
      this.events.emit('task.completed', { taskId: task.id, payload: { capability: task.capability } });

      // Artifacts
      if (task.output?.findings?.length) {
        this.artifacts.register({ type: 'finding', producerTask: task.id, runId: this.runId, content: task.output.findings });
        this.events.emit('artifact.created', { taskId: task.id, payload: { type: 'finding' } });
      }

      // Findings intake: audits append candidates; verification REPLACES the
      // shared list with the verified/refuted/invalid outcomes.
      const newFindings = task.output?.findings || [];
      if (cap.id === 'verification') {
        this.findings = newFindings;
        for (const f of newFindings) {
          this.events.emit(`finding.${f.status === 'refuted' ? 'refuted' : f.status === 'verified' ? 'verified' : 'created'}`, { taskId: task.id, payload: { path: f.path, severity: f.severity } });
        }
      } else {
        for (const f of newFindings) {
          this.findings.push(f);
          this.events.emit(`finding.${f.status === 'refuted' ? 'refuted' : f.status === 'verified' ? 'verified' : 'created'}`, { taskId: task.id, payload: { path: f.path, severity: f.severity } });
        }
      }

      // Keep shared context up-to-date for downstream capabilities
      if (cap.id === 'machine-gates') this.gateResults = task.output.gateResults || [];
      if (cap.id === 'repository-intelligence') this.snapshot = task.output.repoSnapshot;
      if (cap.id === 'semantic-analysis') { this.semantic = task.output.semantic; this.importGraphSize = task.output.importers; }
      if (cap.id === 'policy-evaluation') this.lastDecision = task.output.decision;
      if (cap.id === 'remediation') this.patches = task.output.patches || [];

      // Re-plan (DW-06)
      const { newTasks, decisions } = replan({
        task, result: task.output, findings: this.findings,
        policy: { profile: this.policyProfile }, budget: this.budget,
      });
      for (const nt of newTasks) {
        this.dag.addTask(nt);
        this.events.emit('task.created', { taskId: nt.id, payload: { capability: nt.capability, replanned: true } });
        if (nt.requiresApproval) {
          this.dag.transition(nt, 'WAITING_FOR_HUMAN');
          this.events.emit('human.approval.requested', { taskId: nt.id, payload: { title: nt.title } });
        }
      }
      for (const d of decisions) {
        this.decisions.push(d);
        this.events.emit('decision.created', { taskId: task.id, payload: { reason: d.reason, outcome: d.outcome } });
      }
      if (newTasks.length > 0) {
        this.events.emit('replan.requested', { taskId: task.id, payload: { created: newTasks.length } });
      }
      this._persist();
      this.checkpoint();
    } catch (err) {
      // Any unexpected error in the task lifecycle goes through the
      // failure classifier — a task can never hang the drive loop.
      this._failTask(task, err);
    }
  }

  _failTask(task, err) {
    const cls = classifyFailure(err);
    const strategy = recoveryStrategyFor(cls);
    this.events.emit('task.failed', { taskId: task.id, payload: { class: cls, message: String(err.message).slice(0, 200) } });

    const safeTransition = (to) => {
      try { this.dag.transition(task, to); return true; } catch { return false; }
    };

    if (strategy.retry && task.attempts < task.maxRetries) {
      task.attempts += 1;
      this.budget.charge('retriesUsed');
      if (safeTransition('RETRYING') && safeTransition('READY')) {
        this.events.emit('task.retrying', { taskId: task.id, payload: { attempt: task.attempts, class: cls } });
        return;
      }
    }

    if (!safeTransition('FAILED')) {
      // terminal states accept no transitions; leave the task as-is
      task.error = { class: cls, message: String(err.message).slice(0, 300) };
      this._persist();
      return;
    }
    task.error = { class: cls, message: String(err.message).slice(0, 300) };
    task.finishedAt = new Date().toISOString();

    if (strategy.abort) {
      this.run.status = 'FAILED';
      this.events.emit('workflow.failed', { taskId: task.id, payload: { class: cls } });
    } else if (strategy.replan) {
      if (task.status === 'FAILED') {
        // NEEDS_REPLAN from FAILED is legal; PENDING from NEEDS_REPLAN re-queues it
        if (safeTransition('NEEDS_REPLAN')) safeTransition('PENDING');
      }
    }
    this._persist();
  }

  _reducedScopeReplan() {
    // Reduced-scope replanning: drop lowest-priority PENDING audit tasks,
    // keep the critical path (verification, reporting).
    for (const t of this.dag.tasks.values()) {
      if (t.status === 'PENDING' && t.priority >= 3) {
        this.dag.transition(t, 'CANCELLED');
      }
    }
  }

  // ── Context & helpers ──────────────────────────────────────────────────────

  _defaultToolsFor(cap) {
    const agent = this.agentRegistry.get((this.agentRegistry.agentsFor(cap.id)[0] || {}).id);
    return agent ? agent.tools : Object.keys(TOOL_REGISTRY);
  }

  _capabilityContext(task) {
    return {
      root: this.root,
      task,
      llm: this.llm,
      sandbox: 'trusted',
      policyProfile: this.policyProfile,
      files: (this.snapshot?.allFiles || []).map((f) => f.path),
      snapshot: this.snapshot || { tests: [], allFiles: [] },
      findings: this.findings,
      evidence: this.evidence,
      gateResults: this.gateResults || [],
      lastDecision: this.lastDecision,
      patches: this.patches || [],
      decision: this.lastDecision,
      importGraph: this.importGraph || { importers: new Map() },
      events: this.events,
      artifacts: this.artifacts,
      tools: task.allowedTools || this._defaultToolsFor(this.capabilities.get(task.capability) || { requiredTools: [] }),
    };
  }

  _conditionContext() {
    return {
      evaluateCondition,
      findings: this.findings,
      policy: { profile: this.policyProfile },
      budget: { exceeded: this.budget.exceeded },
      repo: { root: this.root },
    };
  }

  attachEvidence(evidence) {
    this.evidence = evidence;
  }

  _persist() {
    this.state.saveWorkflow(this.workflow, this.run);
    this.state.saveTasks([...this.dag.tasks.values()]);
    this.state.saveDecisions(this.decisions);
    this.state.saveTelemetry({
      status: this.run.status,
      findings: this.findings.length,
      decisions: this.decisions.length,
      completed: [...this.dag.tasks.values()].filter((t) => t.status === 'SUCCEEDED').length,
    });
  }

  checkpoint() {
    return this.state.checkpoint({
      tasks: [...this.dag.tasks.values()],
      graphVersion: this.dag.graphVersion,
      counters: { completed: this.completedCount, findings: this.findings.length },
    });
  }

  _finalResult() {
    const tasks = [...this.dag.tasks.values()];
    const waiting = tasks.some((t) => t.status === 'WAITING_FOR_HUMAN');
    const allSettled = tasks.every((t) => ['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(t.status));

    if (this._cancelled) {
      this.run.status = 'CANCELLED';
    } else if (waiting && !allSettled) {
      this.run.status = 'PAUSED';
    } else if (this.run.status === 'BUDGET_EXCEEDED') {
      // keep
    } else if (tasks.some((t) => t.status === 'FAILED')) {
      this.run.status = 'FAILED';
    } else {
      this.run.status = 'COMPLETED';
    }
    this.run.finishedAt = new Date().toISOString();
    this.events.emit('workflow.completed', { payload: { status: this.run.status } });
    this._persist();

    return {
      runId: this.runId,
      status: this.run.status,
      tasks: tasks.map((t) => ({ id: t.id, capability: t.capability, status: t.status, title: t.title })),
      findings: this.findings,
      decisions: this.decisions,
      kpi: this.kpi(),
    };
  }

  /** Restore in-memory context from persisted task outputs after a crash. */
  _hydrateFromTasks(tasks) {
    for (const t of tasks) {
      if (t.status !== 'SUCCEEDED' || !t.output) continue;
      if (t.capability === 'repository-intelligence') this.snapshot = t.output.repoSnapshot;
      if (t.capability === 'machine-gates') this.gateResults = t.output.gateResults || [];
      if (t.capability === 'policy-evaluation') this.lastDecision = t.output.decision;
      if (t.capability === 'remediation') this.patches = t.output.patches || [];
      if (t.capability === 'verification') this.findings = t.output.findings || [];
    }
    // Candidate findings from audit capabilities that completed before the crash
    for (const t of tasks) {
      if (t.status !== 'SUCCEEDED' || !t.output?.findings) continue;
      if (['security-audit', 'correctness-audit', 'architecture-audit', 'testing-audit', 'performance-audit', 'supply-chain-audit', 'self-audit'].includes(t.capability)) {
        for (const f of t.output.findings) {
          if (!this.findings.some((x) => x.path === f.path && x.problem === f.problem)) {
            this.findings.push(f);
          }
        }
      }
    }
  }

  /** Wait until human gates resolve (used by approve/reject + continue). */
  async continueAfterGate() {
    this.run.status = 'RUNNING';
    this.events.emit('workflow.resumed', { payload: { reason: 'gate_resolved' } });
    await this._drive();
    return this._finalResult();
  }

  kpi() {
    const tasks = [...this.dag.tasks.values()];
    const by = (s) => tasks.filter((t) => t.status === s).length;
    return {
      total: tasks.length,
      succeeded: by('SUCCEEDED'),
      failed: by('FAILED'),
      running: by('RUNNING'),
      pending: tasks.filter((t) => ['PENDING', 'READY', 'BLOCKED'].includes(t.status)).length,
      waitingHuman: by('WAITING_FOR_HUMAN'),
      skipped: by('SKIPPED'),
      elapsedMs: this.run.startedAt ? Date.now() - new Date(this.run.startedAt).getTime() : 0,
      replans: this.events.count('replan.requested'),
      retries: this.events.count('task.retrying'),
      findings: this.findings.length,
    };
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASK_STATES, assertTaskTransition, createTask } from '../../src/workflow/schemas.mjs';
import { DynamicDag, DagCycleError } from '../../src/workflow/dag.mjs';
import { evaluateCondition } from '../../src/workflow/conditions.mjs';
import { Budget } from '../../src/workflow/budget.mjs';
import { EventBus, EVENT_TYPES } from '../../src/workflow/events.mjs';
import { WorkflowStateStore } from '../../src/workflow/state.mjs';
import { ArtifactStore } from '../../src/workflow/artifacts.mjs';
import { CapabilityRegistry, TOOL_REGISTRY, assertToolsAllowed, ToolPermissionError, applyUnifiedDiff } from '../../src/workflow/capabilities.mjs';
import { AgentRegistry } from '../../src/workflow/agents.mjs';
import { classifyFailure, recoveryStrategyFor } from '../../src/workflow/failures.mjs';

// ── DW-01: Task state machine ────────────────────────────────────────────────

test('task state machine: legal transitions pass, illegal fail deterministically', () => {
  assertTaskTransition('PENDING', 'READY');
  assertTaskTransition('READY', 'RUNNING');
  assertTaskTransition('RUNNING', 'SUCCEEDED');
  assertTaskTransition('RUNNING', 'RETRYING');
  assertTaskTransition('RETRYING', 'READY');
  assertTaskTransition('WAITING_FOR_HUMAN', 'READY');
  assert.throws(() => assertTaskTransition('SUCCEEDED', 'RUNNING'), /Illegal task transition/);
  assert.throws(() => assertTaskTransition('PENDING', 'SUCCEEDED'), /Illegal task transition/);
  assert.ok(TASK_STATES.includes('NEEDS_REPLAN'));
});

// ── DW-02: Dynamic DAG ───────────────────────────────────────────────────────

test('dynamic DAG: ready resolution honors dependencies and priority', () => {
  const dag = new DynamicDag();
  const a = createTask({ capability: 'c1', title: 'A', priority: 2 });
  const b = createTask({ capability: 'c2', title: 'B', priority: 1 });
  const c = createTask({ capability: 'c3', title: 'C', dependsOn: [a.id] });
  dag.addTask(a); dag.addTask(b); dag.addTask(c);

  let ready = dag.readyTasks();
  assert.deepEqual(ready.map((t) => t.id), [b.id, a.id]); // priority 1 before 2

  dag.transition(a, 'READY'); dag.transition(a, 'RUNNING'); dag.transition(a, 'SUCCEEDED');
  dag.transition(b, 'READY'); dag.transition(b, 'RUNNING'); dag.transition(b, 'SUCCEEDED');
  ready = dag.readyTasks();
  assert.deepEqual(ready.map((t) => t.id), [c.id]);
});

test('dynamic DAG rejects cycles deterministically', () => {
  const dag = new DynamicDag();
  const a = createTask({ capability: 'c', title: 'A' });
  const b = createTask({ capability: 'c', title: 'B' });
  dag.addTask(a); dag.addTask(b);
  dag.addDependency(b.id, a.id);
  assert.throws(() => dag.addDependency(a.id, b.id), DagCycleError);
});

test('dynamic DAG supports runtime split & merge', () => {
  const dag = new DynamicDag();
  const a = createTask({ capability: 'c', title: 'A' });
  const next = createTask({ capability: 'c', title: 'Next', dependsOn: [a.id] });
  dag.addTask(a); dag.addTask(next);

  const { second } = dag.splitTask(a.id, createTask({ capability: 'c', title: 'Split' }));
  assert.deepEqual(next.dependsOn.map((d) => d.from), [second.id]);

  const merged = dag.mergeTasks(a.id, second.id);
  assert.equal(merged.id, a.id);
  assert.ok(!dag.tasks.has(second.id));
  assert.deepEqual(next.dependsOn.map((d) => d.from), [a.id]);
});

test('conditional dependencies: unmet condition skips the dependent task', () => {
  const dag = new DynamicDag();
  const gate = createTask({ capability: 'c', title: 'Gate' });
  const branch = createTask({ capability: 'c', title: 'Branch', dependsOn: [{ from: gate.id, condition: { field: 'findings.high', op: 'gte', value: 1 } }] });
  dag.addTask(gate); dag.addTask(branch);

  dag.transition(gate, 'READY'); dag.transition(gate, 'RUNNING'); dag.transition(gate, 'SUCCEEDED');
  // No high findings → branch skipped
  const skipped = dag.resolveSkips({ findings: { high: 0 }, evaluateCondition });
  assert.equal(skipped.length, 1);
  assert.equal(branch.status, 'SKIPPED');
});

test('DAG snapshot/restore roundtrips tasks', () => {
  const dag = new DynamicDag();
  dag.addTask(createTask({ capability: 'c', title: 'A' }));
  const snap = dag.snapshot();
  const dag2 = new DynamicDag();
  dag2.restore(snap.tasks);
  assert.equal(dag2.tasks.size, 1);
});

// ── DW-10: Condition DSL ─────────────────────────────────────────────────────

test('condition DSL: safe data expressions with severity ranking and combinators', () => {
  const ctx = { findings: { high: 2 }, finding: { severity: 'high' }, policy: { profile: 'OWASP-Top10' } };
  assert.equal(evaluateCondition({ field: 'findings.high', op: 'gte', value: 1 }, ctx), true);
  assert.equal(evaluateCondition({ field: 'finding.severity', op: 'gte', value: 'high' }, ctx), true);
  assert.equal(evaluateCondition({ field: 'finding.severity', op: 'gte', value: 'critical' }, ctx), false);
  assert.equal(evaluateCondition({ all: [{ field: 'findings.high', op: 'gte', value: 1 }, { field: 'policy.profile', op: 'eq', value: 'OWASP-Top10' }] }, ctx), true);
  assert.equal(evaluateCondition({ any: [{ field: 'findings.high', op: 'eq', value: 0 }, { field: 'policy.profile', op: 'eq', value: 'OWASP-Top10' }] }, ctx), true);
  assert.equal(evaluateCondition({ not: { field: 'findings.high', op: 'gte', value: 1 } }, ctx), false);
  assert.equal(evaluateCondition({ field: 'ghost.path', op: 'exists' }, ctx), false, 'unknown fields fail closed');
});

// ── DW-13: Budget engine ─────────────────────────────────────────────────────

test('budget engine: soft warning then hard limit', () => {
  const b = new Budget({ maxTasks: 10, maxRuntimeMs: 60000 });
  for (let i = 0; i < 8; i++) b.charge('tasksExecuted'); // 8/10 = 80% soft threshold
  let res = b.check();
  assert.equal(res.ok, true);
  assert.ok(res.softWarnings.some((w) => w.dimension === 'maxTasks'));

  b.charge('tasksExecuted'); b.charge('tasksExecuted'); // 10/10 → hard limit
  res = b.check();
  assert.equal(res.ok, false);
  assert.equal(res.exceeded.dimension, 'maxTasks');
});

// ── DW-07: Event bus ─────────────────────────────────────────────────────────

test('event bus: correlation ids, subscribers, replay and counters', () => {
  const bus = new EventBus({ runId: 'run_x' });
  const seen = [];
  bus.subscribe(['task.created'], (e) => seen.push(e.type));
  bus.emit('task.created', { taskId: 't1' });
  bus.emit('task.completed', { taskId: 't1' });
  bus.emit('finding.verified', { taskId: 't1', payload: { severity: 'high' } });

  assert.equal(seen.length, 1);
  assert.equal(bus.count('task.created'), 1);
  assert.equal(bus.all().every((e) => e.correlationId === 'run_x' && e.seq > 0), true);
  bus.replay((e) => { void e; });
  assert.ok(EVENT_TYPES.includes('replan.requested'));
});

// ── DW-08/09: State store, checkpoints, artifacts ────────────────────────────

test('state store: checkpoint → validate → restore roundtrip on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-wf-'));
  const store = new WorkflowStateStore(dir, 'run_cp1');
  store.init();
  store.saveWorkflow({ id: 'wf1' }, { runId: 'run_cp1', status: 'RUNNING' });

  const tasks = [createTask({ capability: 'c', title: 'T' })];
  const cp = store.checkpoint({ tasks, graphVersion: 3, counters: { completed: 0 } });
  assert.ok(existsSync(join(dir, 'run_cp1', 'latest-checkpoint.json')));
  const validation = store.validateCheckpoint(cp);
  assert.equal(validation.ok, true);

  const loaded = store.latestCheckpoint();
  assert.equal(loaded.tasks[0].title, 'T');
  assert.equal(JSON.parse(readFileSync(join(dir, 'run_cp1', 'workflow.json'), 'utf-8')).workflow.id, 'wf1');
  rmSync(dir, { recursive: true, force: true });
});

test('artifact store: hash integrity + type validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-art-'));
  const store = new ArtifactStore(dir);
  const rec = store.register({ type: 'finding', producerTask: 't1', runId: 'run_a', content: { hello: 'world' } });
  assert.equal(store.verifyIntegrity(rec.id).ok, true);
  assert.throws(() => store.register({ type: 'bogus', producerTask: 't', runId: 'r', content: {} }), /Unknown artifact type/);
  rmSync(dir, { recursive: true, force: true });
});

// ── STEP 6: Tool permissions ─────────────────────────────────────────────────

test('tool permissions: missing tools are policy-denied (no self-elevation)', () => {
  assert.doesNotThrow(() => assertToolsAllowed(['readFile', 'runDetector'], ['readFile']));
  assert.throws(() => assertToolsAllowed(['readFile'], ['writePatch']), ToolPermissionError);
  assert.ok(TOOL_REGISTRY.writePatch.safetyLevel === 'write');
});

// ── DW-04: Agent registry ────────────────────────────────────────────────────

test('agent registry: dynamic selection with provider fallback chain', () => {
  const reg = new AgentRegistry();
  const primary = reg.selectAgent('security-audit');
  assert.equal(primary.id, 'security-specialist');

  const fallback = reg.selectAgent('security-audit', { availableProviders: ['openai'] });
  assert.ok(fallback, 'fallback agent found for openai-only environment');
});

// ── DW-03: Capability registry ───────────────────────────────────────────────

test('capability registry validates manifests and exposes the full capability set', () => {
  const reg = new CapabilityRegistry();
  const ids = reg.list().map((c) => c.id);
  for (const required of ['repository-intelligence', 'machine-gates', 'semantic-analysis', 'security-audit', 'verification', 'reproduction', 'remediation', 'regression', 'policy-evaluation', 'reporting', 'human-approval', 'self-audit']) {
    assert.ok(ids.includes(required), `capability ${required} must be registered`);
  }
  assert.throws(() => reg.register({ id: 'bad' }), /missing field/);
});

// ── DW-12: Failure classification ────────────────────────────────────────────

test('failure classifier maps errors to recovery strategies', () => {
  assert.equal(classifyFailure(new Error('task timed out after 100ms')), 'timeout');
  assert.equal(classifyFailure(new Error('budget exceeded')), 'budget-exceeded');
  assert.equal(classifyFailure(new Error('policy denied by guard')), 'policy-denied');
  assert.equal(recoveryStrategyFor('timeout').retry, true);
  assert.equal(recoveryStrategyFor('budget-exceeded').abort, true);
});

// ── In-memory unified diff applier ───────────────────────────────────────────

test('applyUnifiedDiff applies a clean diff and rejects a dirty one', () => {
  const original = 'line1\nline2\nline3\n';
  const cleanDiff = ['--- a/f.ts', '+++ b/f.ts', '@@ -1,3 +1,3 @@', ' line1', '-line2', '+line2 patched', ' line3'].join('\n');
  assert.equal(applyUnifiedDiff(original, cleanDiff), 'line1\nline2 patched\nline3\n');

  const dirtyDiff = ['--- a/f.ts', '+++ b/f.ts', '@@ -1,3 +1,3 @@', ' nope', '-ghost', '+x', ' line3'].join('\n');
  assert.equal(applyUnifiedDiff(original, dirtyDiff), null);
});

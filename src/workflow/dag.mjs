/**
 * Arena Audit — Dynamic Task DAG (DW-02)
 *
 * A graph that may change while running:
 *  - add / remove / split / merge tasks at runtime
 *  - dynamic & conditional dependencies
 *  - cycle detection
 *  - ready-task resolution by priority
 *  - snapshots
 *
 * No hard-coded phase pipeline lives here — the DAG is fully data-driven.
 */

import { assertTaskTransition } from './schemas.mjs';

export class DagCycleError extends Error {
  constructor(path) {
    super(`Adding this dependency would create a cycle: ${path.join(' → ')}`);
    this.name = 'DagCycleError';
  }
}

export class DynamicDag {
  constructor() {
    /** Map<taskId, task> */
    this.tasks = new Map();
    this.graphVersion = 1;
  }

  addTask(task) {
    if (this.tasks.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    this.tasks.set(task.id, task);
    this.graphVersion++;
    // validate acyclicity including the new node's dependencies
    this._assertAcyclic(task.id);
    return task;
  }

  removeTask(taskId) {
    if (!this.tasks.has(taskId)) return false;
    // cannot remove a running task
    const t = this.tasks.get(taskId);
    if (t.status === 'RUNNING') throw new Error(`Cannot remove RUNNING task ${taskId}`);
    this.tasks.delete(taskId);
    for (const other of this.tasks.values()) {
      other.dependsOn = other.dependsOn.filter((d) => this._depId(d) !== taskId);
    }
    this.graphVersion++;
    return true;
  }

  addDependency(taskId, dependsOnTaskId, condition = null) {
    if (taskId === dependsOnTaskId) throw new DagCycleError([taskId, taskId]);
    const task = this.tasks.get(taskId);
    const dep = this.tasks.get(dependsOnTaskId);
    if (!task || !dep) throw new Error(`Unknown task in dependency ${dependsOnTaskId} → ${taskId}`);
    task.dependsOn.push({ from: dependsOnTaskId, condition });
    this._assertAcyclic(taskId);
    this.graphVersion++;
    return task;
  }

  /** Split one task into two chained tasks (split: first → second). */
  splitTask(taskId, secondTask) {
    const first = this.tasks.get(taskId);
    if (!first) throw new Error(`Unknown task: ${taskId}`);
    // second inherits first's dependents
    secondTask.dependsOn = [{ from: first.id }];
    this.addTask(secondTask);
    for (const other of this.tasks.values()) {
      other.dependsOn = other.dependsOn.map((d) =>
        this._depId(d) === first.id ? { ...d, from: secondTask.id } : d);
    }
    return { first, second: secondTask };
  }

  /** Merge two tasks: second is removed, its deps move to first. */
  mergeTasks(keepId, dropId) {
    const keep = this.tasks.get(keepId);
    const drop = this.tasks.get(dropId);
    if (!keep || !drop) throw new Error('mergeTasks: unknown task');
    for (const d of drop.dependsOn) {
      if (this._depId(d) !== keepId) keep.dependsOn.push(d);
    }
    for (const other of this.tasks.values()) {
      other.dependsOn = other.dependsOn.map((d) =>
        this._depId(d) === dropId ? { ...d, from: keepId } : d);
    }
    this.removeTask(dropId);
    return keep;
  }

  /**
   * Tasks whose dependencies are satisfied and are still PENDING.
   * Sorted by priority (1 first), then creation order.
   */
  readyTasks(context = {}) {
    const ready = [];
    for (const task of this.tasks.values()) {
      if (task.status !== 'PENDING') continue;
      const deps = task.dependsOn || [];
      let satisfied = true;
      for (const d of deps) {
        const dep = this.tasks.get(this._depId(d));
        if (!dep) { satisfied = false; break; }
        if (dep.status !== 'SUCCEEDED' && dep.status !== 'SKIPPED') { satisfied = false; break; }
        // conditional dependency: if condition false → dependent is skipped later
        if (dep.status === 'SUCCEEDED' && d.condition) {
          const outcome = this._evalCondition(d.condition, context);
          if (outcome === false) { satisfied = false; break; }
        }
      }
      if (satisfied) ready.push(task);
    }
    return ready.sort((a, b) => a.priority - priorityOf(b) || a.createdAt.localeCompare(b.createdAt));
    function priorityOf(t) { return t.priority; }
  }

  /**
   * Conditional-branch resolution: when a dependency's condition evaluates
   * false, the dependent task is SKIPPED (branch not taken).
   * Returns the list of skipped tasks.
   */
  resolveSkips(context = {}) {
    const skipped = [];
    for (const task of this.tasks.values()) {
      if (task.status !== 'PENDING') continue;
      for (const d of task.dependsOn || []) {
        const dep = this.tasks.get(this._depId(d));
        if (dep && dep.status === 'SUCCEEDED' && d.condition) {
          if (this._evalCondition(d.condition, context) === false) {
            assertTaskTransition(task.status, 'SKIPPED');
            task.status = 'SKIPPED';
            task.output = { skippedReason: `condition not met on dependency ${this._depId(d)}` };
            skipped.push(task);
            this.graphVersion++;
            break;
          }
        }
      }
    }
    return skipped;
  }

  transition(task, to) {
    assertTaskTransition(task.status, to);
    task.status = to;
    return task;
  }

  snapshot() {
    return {
      graphVersion: this.graphVersion,
      tasks: [...this.tasks.values()].map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
    };
  }

  restore(snapshotTasks) {
    this.tasks = new Map(snapshotTasks.map((t) => [t.id, { ...t, dependsOn: [...t.dependsOn] }]));
    this.graphVersion++;
  }

  _depId(dep) { return typeof dep === 'string' ? dep : dep.from; }

  _evalCondition(condition, context) {
    // condition: { field, op, value } evaluated by the injected evaluator
    if (typeof condition === 'function') return condition(context); // in-memory use only
    if (context && typeof context.evaluateCondition === 'function') {
      return context.evaluateCondition(condition, context);
    }
    return true; // no evaluator → conditions default to taken
  }

  _assertAcyclic(newTaskId) {
    // DFS from newTaskId across dependencies; if we revisit newTaskId → cycle
    const stack = [[newTaskId, []]];
    const seen = new Set();
    while (stack.length) {
      const [id, path] = stack.pop();
      if (id === newTaskId && path.length > 0) {
        throw new DagCycleError([...path, newTaskId]);
      }
      if (seen.has(id)) continue;
      seen.add(id);
      const t = this.tasks.get(id);
      if (!t) continue;
      for (const d of t.dependsOn || []) {
        const depId = this._depId(d);
        stack.push([depId, [...path, id]]);
      }
    }
  }

  /** Adjacency list for graph views. */
  graphView() {
    return [...this.tasks.values()].map((t) => ({
      id: t.id,
      capability: t.capability,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dependsOn: (t.dependsOn || []).map((d) => this._depId(d)),
      requiresApproval: t.requiresApproval,
    }));
  }
}

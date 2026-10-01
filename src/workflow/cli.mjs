/**
 * Arena Audit — Workflow CLI (DW-14, DW-16)
 *
 * Commands (under `arena-audit workflow ...`):
 *   start [--root dir] [--goal g] [--max-concurrency n] [--state-dir dir] [--llm]
 *   status <run-id>       — KPI snapshot
 *   inspect <run-id>      — full detail (workflow + decisions + telemetry)
 *   tasks <run-id>        — task list with statuses
 *   graph <run-id>        — ASCII dependency graph
 *   events <run-id> [n]   — last n events (default 20)
 *   resume <run-id>       — resume a paused/crashed run
 *   cancel <run-id>       — cancel a run
 *   approve <task-id>     — resolve a human gate (approve)
 *   reject <task-id>      — resolve a human gate (reject)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WorkflowEngine } from '../workflow/engine.mjs';
import { WorkflowStateStore } from '../workflow/state.mjs';

function findRunDir(stateRoot, runId) {
  const dir = join(stateRoot, runId);
  if (existsSync(dir)) return dir;
  return null;
}

function loadRunState(stateRoot, runId) {
  const dir = findRunDir(stateRoot, runId);
  if (!dir) throw new Error(`Unknown workflow run: ${runId} (state root: ${stateRoot})`);
  const store = new WorkflowStateStore(stateRoot, runId);
  return {
    store,
    workflow: store.loadWorkflow().workflow,
    run: store.loadWorkflow().run,
    tasks: store.loadTasks(),
    decisions: store.loadDecisions(),
    events: store.loadEvents(),
  };
}

function printKpis(run, tasks) {
  const by = (s) => tasks.filter((t) => t.status === s).length;
  console.log(`  Status:        ${run.status}`);
  console.log(`  Tasks:         ${tasks.length} total · ${by('SUCCEEDED')} succeeded · ${by('FAILED')} failed · ${by('RUNNING')} running · ${by('PENDING') + by('READY')} pending · ${by('WAITING_FOR_HUMAN')} awaiting human · ${by('SKIPPED')} skipped`);
  const elapsed = run.finishedAt
    ? new Date(run.finishedAt) - new Date(run.startedAt)
    : Date.now() - new Date(run.startedAt).getTime();
  console.log(`  Elapsed:       ${(elapsed / 1000).toFixed(1)}s`);
}

export async function workflowMain(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    else positional.push(argv[i]);
  }

  const cmd = positional[0];
  const stateRoot = resolve(process.cwd(), flags['state-dir'] || join('.arena', 'workflows'));
  const root = resolve(process.cwd(), flags.root || '.');
  const llm = flags.llm ? (await import('../agents/llm.mjs')).detectProvider() ? null : null : null; // provider wired via env in engine

  if (cmd === 'start') {
    const engine = new WorkflowEngine({
      root,
      goal: flags.goal || 'audit',
      stateDir: stateRoot,
      maxConcurrency: parseInt(flags['max-concurrency'] || '4', 10),
      policyProfile: flags.profile || 'OWASP-Top10',
      budgetLimits: flags['max-tasks'] ? { maxTasks: parseInt(flags['max-tasks'], 10) } : {},
    });
    const result = await engine.start();
    console.log(`Workflow ${result.runId} → ${result.status}`);
    printKpis({ status: result.status, startedAt: engine.run.startedAt, finishedAt: engine.run.finishedAt }, result.tasks);
    console.log(`  State:         ${join(stateRoot, result.runId)}`);
    if (result.status === 'PAUSED') {
      const gates = result.tasks.filter((t) => t.status === 'WAITING_FOR_HUMAN');
      console.log(`  ⏸  Human gates pending: ${gates.map((t) => t.id).join(', ')}`);
      console.log(`     Approve:  node bin/arena-audit.mjs workflow approve <task-id> --state-dir ${stateRoot}`);
    }
    return;
  }

  if (cmd === 'resume') {
    const runId = positional[1];
    const engine = new WorkflowEngine({ root, stateDir: stateRoot, runId, llm });
    const result = await engine.resume();
    console.log(`Workflow ${result.runId} resumed → ${result.status}`);
    printKpis({ status: result.status, startedAt: engine.run.startedAt }, result.tasks);
    return;
  }

  if (cmd === 'cancel') {
    const runId = positional[1];
    const engine = new WorkflowEngine({ root, stateDir: stateRoot, runId });
    engine.restoreForCli?.();
    // Lightweight cancel: mark state via store
    const state = loadRunState(stateRoot, runId);
    state.run.status = 'CANCELLED';
    state.store.saveWorkflow(state.workflow, state.run);
    for (const t of state.tasks) {
      if (['PENDING', 'READY', 'BLOCKED', 'WAITING_FOR_HUMAN'].includes(t.status)) t.status = 'CANCELLED';
    }
    state.store.saveTasks(state.tasks);
    console.log(`Workflow ${runId} cancelled.`);
    return;
  }

  if (cmd === 'status' || cmd === 'inspect') {
    const runId = positional[1];
    const state = loadRunState(stateRoot, runId);
    console.log(`Workflow Run: ${runId}`);
    console.log(`  Goal:          ${state.workflow?.goal || 'n/a'}`);
    printKpis(state.run, state.tasks);
    if (cmd === 'inspect') {
      console.log('  Decisions:');
      for (const d of state.decisions.slice(-10)) console.log(`    - [${d.outcome}] ${d.reason}`);
      const tel = join(stateRoot, runId, 'telemetry.json');
      if (existsSync(tel)) {
        const t = JSON.parse(readFileSync(tel, 'utf-8'));
        console.log(`  Telemetry:     ${t.findings ?? 0} findings · ${t.completed ?? 0} completed tasks`);
      }
    }
    return;
  }

  if (cmd === 'tasks') {
    const runId = positional[1];
    const { tasks } = loadRunState(stateRoot, runId);
    for (const t of tasks) {
      console.log(`${t.status.padEnd(18)} ${t.capability.padEnd(26)} ${t.title}`);
    }
    return;
  }

  if (cmd === 'graph') {
    const runId = positional[1];
    const { tasks } = loadRunState(stateRoot, runId);
    for (const t of tasks) {
      const deps = (t.dependsOn || []).map((d) => (typeof d === 'string' ? d : d.from));
      console.log(`${t.id} [${t.status}] ${t.capability}`);
      for (const d of deps) console.log(`    ↑ depends on ${d}`);
    }
    return;
  }

  if (cmd === 'events') {
    const runId = positional[1];
    const n = parseInt(positional[2] || '20', 10);
    const { events } = loadRunState(stateRoot, runId);
    for (const e of events.slice(-n)) {
      console.log(`${e.seq.toString().padStart(4)} ${e.timestamp.slice(11, 19)} ${e.type.padEnd(28)} ${e.taskId || ''} ${JSON.stringify(e.payload).slice(0, 100)}`);
    }
    return;
  }

  if (cmd === 'approve' || cmd === 'reject') {
    const taskId = positional[1];
    // locate the run containing this task
    if (!existsSync(stateRoot)) throw new Error(`No workflow state at ${stateRoot}`);
    for (const runId of readdirSync(stateRoot)) {
      const dir = join(stateRoot, runId);
      const tasksPath = join(dir, 'tasks.json');
      if (!existsSync(tasksPath)) continue;
      const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
      const task = tasks.find((t) => t.id === taskId);
      if (!task) continue;
      const store = new WorkflowStateStore(stateRoot, runId);
      const state = loadRunState(stateRoot, runId);
      const actor = flags.approver || process.env.USERNAME || 'unknown';
      if (cmd === 'approve') {
        task.approval = { status: 'approved', approver: actor, note: flags.note || null, at: new Date().toISOString() };
        if (task.status === 'WAITING_FOR_HUMAN') task.status = 'READY';
        store.saveTasks(tasks);
        console.log(`✅ Task ${taskId} approved by ${actor}. Resume the workflow to continue: workflow resume ${runId}`);
      } else {
        task.approval = { status: 'rejected', reason: flags.reason || 'no reason given', approver: actor, at: new Date().toISOString() };
        if (['WAITING_FOR_HUMAN', 'READY', 'PENDING'].includes(task.status)) task.status = 'CANCELLED';
        store.saveTasks(tasks);
        console.log(`🗑️  Task ${taskId} rejected (${task.approval.reason}).`);
      }
      void state;
      return;
    }
    throw new Error(`Task not found in any workflow run under ${stateRoot}: ${taskId}`);
  }

  throw new Error(`Unknown workflow command: ${cmd || '(none)'} — see docs/workflow/architecture.md`);
}

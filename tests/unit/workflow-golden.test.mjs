import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WorkflowEngine } from '../../src/workflow/engine.mjs';

let root;
let stateDir;

const RUNNER_TS = `export function runExpr(expr: string): unknown {
  return eval(expr);
}
`;
const PRICING_TS = `export function price(amount: number): number {
  return amount * 1.1;
}
`;

// Mock LLM: handles the remediation role (canned clean patch) and the
// verifier role (confirms findings) — so the full multi-agent tournament
// runs without any API key.
const mockLlm = async (system, prompt) => {
  if (prompt.includes('unified diff')) {
    return JSON.stringify({
      explanation: 'Remove dynamic evaluation; return null until a safe dispatcher exists.',
      diff: [
        '--- a/src/runner.ts',
        '+++ b/src/runner.ts',
        '@@ -1,3 +1,4 @@',
        ' export function runExpr(expr: string): unknown {',
        '-  return eval(expr);',
        '+  // removed dynamic evaluation (remediated)',
        '+  return null;',
        ' }',
      ].join('\n'),
    });
  }
  if (prompt.includes('independently verified')) {
    let severity = 'medium';
    try {
      const m = prompt.match(/FINDING:\n(.*)\n/);
      if (m) severity = JSON.parse(m[1]).severity || severity;
    } catch { /* keep default */ }
    return JSON.stringify({
      decision: 'verified',
      confidence: 0.9,
      severity,
      note: 'mock verifier confirms against real code evidence',
    });
  }
  return JSON.stringify({ healthNote: 'mock', findings: [] });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arena-golden-'));
  stateDir = join(root, '.arena', 'workflows');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'runner.ts'), RUNNER_TS, 'utf-8');
  writeFileSync(join(root, 'src', 'pricing.ts'), PRICING_TS, 'utf-8');
  // git repo so worktree patch validation works
  const g = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  g(['init']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  g(['add', '.']); g(['commit', '-m', 'init']);
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ }
});

test('GOLDEN: security finding → verification → reproduction → remediation → regression → human gate → report', async () => {
  const engine = new WorkflowEngine({
    root, goal: 'audit', stateDir, maxConcurrency: 4,
    llm: mockLlm,
  });

  const result = await engine.start();

  // The workflow pauses at the autonomous-patch human gate (DW-11)
  assert.equal(result.status, 'PAUSED');

  const byCap = {};
  for (const t of result.tasks) byCap[t.capability] = t.status;
  assert.equal(byCap['repository-intelligence'], 'SUCCEEDED');
  assert.equal(byCap['security-audit'], 'SUCCEEDED');
  assert.equal(byCap['verification'], 'SUCCEEDED');
  assert.equal(byCap['reproduction'], 'SUCCEEDED');
  assert.equal(byCap['remediation'], 'SUCCEEDED');

  // Findings: eval (high) + money-float (medium), both verified
  const verified = result.findings.filter((f) => f.status === 'verified');
  assert.equal(verified.length, 2);
  assert.ok(verified.some((f) => f.path.startsWith('src/runner.ts') && f.severity === 'high'));

  // Re-plan events fired
  assert.ok(engine.events.count('replan.requested') >= 1);
  assert.ok(engine.events.count('human.approval.requested') >= 1);

  // KPIs reflect live state
  assert.equal(engine.kpi().waitingHuman, 1);

  // ── Human approves the suggested patch ──
  const gateTask = result.tasks.find((t) => t.capability === 'human-approval' && t.status === 'WAITING_FOR_HUMAN');
  engine.approveTask(gateTask.id, { approver: 'ci-bot', note: 'golden approval' });
  const final = await engine.continueAfterGate();

  assert.equal(final.status, 'COMPLETED');
  assert.ok(engine.events.count('human.approval.completed') >= 1);

  // Regression: patched content must not trigger the eval detector anymore
  const regressionTask = final.tasks.find((t) => t.capability === 'regression');
  assert.ok(regressionTask, 'regression task created by re-planner');
  const regTaskFull = [...engine.dag.tasks.values()].find((t) => t.capability === 'regression');
  assert.equal(regTaskFull.output.regressionReport.pass, true);

  // Decisions + checkpoint persisted on disk
  assert.ok(engine.decisions.length >= 2);
  const cp = engine.state.latestCheckpoint();
  assert.ok(cp, 'checkpoint written');
  assert.equal(engine.state.validateCheckpoint(cp).ok, true);
  assert.ok(existsSync(join(stateDir, engine.runId, 'events.jsonl')));
  assert.ok(existsSync(join(stateDir, engine.runId, 'decisions.json')));
});

test('crash recovery: a killed run resumes from checkpoint and completes', async () => {
  const e1 = new WorkflowEngine({
    root, goal: 'audit', stateDir, maxConcurrency: 2, llm: mockLlm,
    testHook: (engine, completedCount) => {
      if (completedCount >= 3) {
        engine.checkpoint();
        throw new Error('SIMULATED_CRASH');
      }
    },
  });

  await assert.rejects(() => e1.start(), /SIMULATED_CRASH/);
  assert.ok(existsSync(join(stateDir, e1.runId, 'tasks.json')), 'state persisted before crash');

  // New engine instance resumes the same run from disk
  const e2 = new WorkflowEngine({ root, goal: 'audit', stateDir, runId: e1.runId, llm: mockLlm });
  let final = await e2.resume();

  // If the resumed run pauses at the autonomous-patch human gate, approve it
  const gate = final.tasks.find((t) => t.capability === 'human-approval' && t.status === 'WAITING_FOR_HUMAN');
  if (gate) {
    e2.approveTask(gate.id, { approver: 'ci-bot' });
    final = await e2.continueAfterGate();
  }

  assert.equal(final.status, 'COMPLETED');
  const succeeded = final.tasks.filter((t) => t.status === 'SUCCEEDED').length;
  assert.ok(succeeded >= 8, `most tasks should succeed after resume (got ${succeeded})`);
});

test('budget exhaustion: hard limit cancels remaining tasks with reduced scope', async () => {
  const engine = new WorkflowEngine({
    root, goal: 'audit', stateDir, maxConcurrency: 2,
    budgetLimits: { maxTasks: 2 },
  });

  const result = await engine.start();
  assert.equal(result.status, 'BUDGET_EXCEEDED');
  assert.ok(engine.events.count('budget.exceeded') >= 1);
  const cancelled = result.tasks.filter((t) => t.status === 'CANCELLED').length;
  assert.ok(cancelled > 0, 'remaining tasks must be cancelled when budget is exhausted');
});

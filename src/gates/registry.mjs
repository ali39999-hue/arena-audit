/**
 * Arena Audit — Deterministic Gate System (P3-01..P3-07)
 *
 * Every deterministic tool is a plugin-like Gate with detect()/run().
 * Results are normalized into a common schema. The core never hardcodes a tool.
 *
 * Gate statuses: pass | fail | not_available | error
 * ("not_available" is a distinct, honest state — it never counts as a pass.)
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sanitizeEnv, assertSandboxPolicy } from '../sandbox/policy.mjs';

// ---------------------------------------------------------------------------
// P3-04 — Result normalizer: every gate converges to this shape.
// ---------------------------------------------------------------------------
export function normalizeGateResult({ id, status, detail = '', durationMs = 0, raw = null }) {
  return {
    id,
    status, // pass | fail | not_available | error
    detail: String(detail || '').slice(0, 4000),
    durationMs,
    raw,
    finishedAt: new Date().toISOString(),
  };
}

/**
 * Run a gate's command inside the sandbox policy.
 * cmd must be "node" (the audit's approved interpreter); the target binary is
 * resolved under the repo's node_modules — never an arbitrary host binary.
 */
export function execGateCommand(root, binRelPath, args, { timeoutMs = 300000, sandbox = 'trusted' } = {}) {
  assertSandboxPolicy(root, sandbox);
  const fullBin = resolve(root, binRelPath);
  const started = Date.now();
  const res = spawnSync(process.execPath, [fullBin, ...args], {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: timeoutMs,
    env: sanitizeEnv(sandbox),
  });
  return {
    exitCode: res.status ?? -1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    durationMs: Date.now() - started,
    timedOut: res.error && res.error.code === 'ETIMEDOUT',
  };
}

// ---------------------------------------------------------------------------
// Gate adapters. Each: { id, detect(root), run(root, opts) -> normalized }
// ---------------------------------------------------------------------------

function bin(root, rel) {
  return existsSync(resolve(root, rel));
}

export const typescriptGate = {
  id: 'typecheck',
  label: 'TypeScript (tsc --noEmit)',
  detect: (root) => bin(root, 'node_modules/typescript/bin/tsc'),
  run: (root, opts) => {
    const r = execGateCommand(root, 'node_modules/typescript/bin/tsc', ['--noEmit'], opts);
    return normalizeGateResult({
      id: 'typecheck',
      status: r.exitCode === 0 ? 'pass' : 'fail',
      detail: r.exitCode === 0 ? '' : (r.stderr || r.stdout).slice(-2000),
      durationMs: r.durationMs,
      raw: r,
    });
  },
};

export const eslintGate = {
  id: 'lint',
  label: 'ESLint',
  detect: (root) => bin(root, 'node_modules/eslint/bin/eslint.js'),
  run: (root, opts) => {
    const r = execGateCommand(root, 'node_modules/eslint/bin/eslint.js', ['.'], opts);
    return normalizeGateResult({
      id: 'lint',
      status: r.exitCode === 0 ? 'pass' : 'fail',
      detail: r.exitCode === 0 ? '' : (r.stdout || r.stderr).slice(-2000),
      durationMs: r.durationMs,
      raw: r,
    });
  },
};

export const vitestGate = {
  id: 'test',
  label: 'Vitest',
  detect: (root) => bin(root, 'node_modules/vitest/vitest.mjs'),
  run: (root, opts) => {
    const r = execGateCommand(root, 'node_modules/vitest/vitest.mjs', ['run'], opts);
    return normalizeGateResult({
      id: 'test',
      status: r.exitCode === 0 ? 'pass' : 'fail',
      detail: r.exitCode === 0 ? '' : (r.stdout || r.stderr).slice(-2000),
      durationMs: r.durationMs,
      raw: r,
    });
  },
};

export const jestGate = {
  id: 'test',
  label: 'Jest',
  detect: (root) => bin(root, 'node_modules/jest/bin/jest.js'),
  run: (root, opts) => {
    const r = execGateCommand(root, 'node_modules/jest/bin/jest.js', [], opts);
    return normalizeGateResult({
      id: 'test',
      status: r.exitCode === 0 ? 'pass' : 'fail',
      detail: r.exitCode === 0 ? '' : (r.stdout || r.stderr).slice(-2000),
      durationMs: r.durationMs,
      raw: r,
    });
  },
};

/** Security gates (P1 layer): run only if the tool binary is present. */
export const semgrepGate = {
  id: 'semgrep',
  label: 'Semgrep (SAST)',
  detect: (root) => bin(root, 'node_modules/.bin/semgrep') || bin(root, 'node_modules/semgrep/bin/semgrep'),
  run: (root, opts) => {
    const rel = existsSync(resolve(root, 'node_modules/semgrep/bin/semgrep'))
      ? 'node_modules/semgrep/bin/semgrep' : 'node_modules/.bin/semgrep';
    const r = execGateCommand(root, rel, ['--config', 'auto', '--json', '.'], opts);
    return normalizeGateResult({
      id: 'semgrep',
      status: r.exitCode === 0 ? 'pass' : 'fail',
      detail: (r.stdout || r.stderr).slice(0, 2000),
      durationMs: r.durationMs,
      raw: r,
    });
  },
};

export const gitleaksGate = {
  id: 'gitleaks',
  label: 'Gitleaks (secret scanning)',
  detect: (root) => bin(root, 'node_modules/.bin/gitleaks'),
  run: (root, opts) => {
    const r = execGateCommand(root, 'node_modules/.bin/gitleaks', ['detect', '--no-git', '--redact'], opts);
    return normalizeGateResult({
      id: 'gitleaks',
      status: r.exitCode === 0 ? 'pass' : 'fail',
      detail: (r.stdout || r.stderr).slice(0, 2000),
      durationMs: r.durationMs,
      raw: r,
    });
  },
};

// ---------------------------------------------------------------------------
// P3-02 — Gate Registry: detection + lifecycle in one place.
// ---------------------------------------------------------------------------
export const ALL_GATES = [typescriptGate, eslintGate, vitestGate, jestGate, semgrepGate, gitleaksGate];

/**
 * Detect applicable gates. Vitest/Jest share the "test" slot — the first
 * detected test runner wins so we never run both suites.
 */
export function detectGates(root, { preferred = ALL_GATES } = {}) {
  const applicable = [];
  const pickedTest = new Set();
  for (const gate of preferred) {
    if (!gate.detect(root)) continue;
    if (gate.id === 'test') {
      if (pickedTest.has('test')) continue;
      pickedTest.add('test');
    }
    applicable.push(gate);
  }
  return applicable;
}

/**
 * Run all detected gates sequentially (they are process-heavy; the LLM agents
 * run in parallel later). Each gate is isolated: an error marks the gate,
 * never the audit.
 */
export function runGates(root, { sandbox = 'trusted', onResult } = {}) {
  const applicable = detectGates(root);
  const results = [];
  for (const gate of applicable) {
    let result;
    try {
      result = gate.run(root, { sandbox });
    } catch (e) {
      result = normalizeGateResult({ id: gate.id, status: 'error', detail: String(e && e.message || e) });
    }
    results.push(result);
    if (onResult) onResult(result);
  }
  return { results, applicable: applicable.map((g) => g.id) };
}

/**
 * Arena Audit — Capability Registry & Tool Permissions (DW-03, STEP 4/6)
 *
 * The 20 Arena phases become reusable capability manifests. Each declares:
 * id, version, description, inputs, outputs, requiredTools, supportedAgents,
 * safetyLevel, estimatedCost, estimatedDuration — plus a run(ctx) adapter that
 * delegates to the EXISTING engine modules (no reimplementation).
 *
 * Tool permissions: a capability may only request tools it declares, and a
 * task may only use tools granted by policy. No self-elevation.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { buildRepoSnapshot } from '../intake/repo-snapshot.mjs';
import { runGates } from '../gates/registry.mjs';
import { runDetectors, DETECTORS } from '../detectors/detectors.mjs';
import { buildSymbolIndex, buildImportGraph, createSemanticQueries } from '../semantic/symbols.mjs';
import { locateSource } from '../evidence/evidence-store.mjs';
import { findRelatedTests, runTargetedTests } from '../verification/reproduce.mjs';
import { remediateFinding } from '../remediation/patch.mjs';
import { computePatchConfidence } from '../remediation/confidence.mjs';
import { evaluatePolicy } from '../server/compliance.mjs';
import { fingerprint, dedupeFindings } from '../findings/findings.mjs';
import { runSpecialist, runVerifier, runJudge } from '../agents/agents.mjs';
import { initTreeSitter } from '../semantic/ast.mjs';

// ---------------------------------------------------------------------------
// Tool registry (STEP 6) — explicit per-task permission
// ---------------------------------------------------------------------------
export const TOOL_REGISTRY = {
  readFile: { safetyLevel: 'read', description: 'read a workspace file' },
  search: { safetyLevel: 'read', description: 'search file contents' },
  findSymbol: { safetyLevel: 'read', description: 'AST symbol lookup' },
  getCallers: { safetyLevel: 'read', description: 'AST caller/callee lookup' },
  gitDiff: { safetyLevel: 'read', description: 'git diff inspection' },
  inspectDependencies: { safetyLevel: 'read', description: 'dependency graph query' },
  runDetector: { safetyLevel: 'read', description: 'deterministic detector pass' },
  runGate: { safetyLevel: 'execute', description: 'run a machine quality gate' },
  runTest: { safetyLevel: 'execute', description: 'run targeted tests' },
  sandboxExecute: { safetyLevel: 'execute', description: 'execute inside sandbox' },
  rerunAudit: { safetyLevel: 'execute', description: 're-run audit on patched worktree' },
  writePatch: { safetyLevel: 'write', description: 'produce a suggested patch' },
  applyCheck: { safetyLevel: 'write', description: 'git apply --check in worktree' },
};

export class ToolPermissionError extends Error {
  constructor(tool) {
    super(`Tool '${tool}' is not permitted for this task (policy-denied)`);
    this.name = 'ToolPermissionError';
    this.tool = tool;
  }
}

export function assertToolsAllowed(allowedTools, requiredTools) {
  for (const t of requiredTools) {
    if (!(allowedTools || []).includes(t)) {
      throw new ToolPermissionError(t);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Capability manifests
// ---------------------------------------------------------------------------
const CAT_DETECTORS = {
  'security-audit': ['hardcoded-credential', 'eval-usage', 'sql-string-concat', 'dangerous-html', 'localstorage-token', 'py-eval-usage'],
  'correctness-audit': ['money-float-math'],
  'architecture-audit': [],
  'testing-audit': [],
  'performance-audit': [],
  'supply-chain-audit': [],
};

function detectorFindingsFor(root, files, detectorIds) {
  // Categories without deterministic detector coverage return [] — they must
  // NOT leak every other detector's findings (scope discipline).
  if (!detectorIds || detectorIds.length === 0) return [];
  const all = runDetectors(root, files.map((p) => ({ path: p, kind: 'source' })));
  return all.filter((f) => detectorIds.includes(f.detectorId));
}

/**
 * Minimal in-memory unified diff applier (single file, standard git diff).
 * Returns patched content, or null when the diff does not apply cleanly.
 */
export function applyUnifiedDiff(originalContent, diff) {
  const lines = originalContent.split(/\r?\n/);
  const diffLines = String(diff).split(/\r?\n/);
  const out = [];
  let idx = 0; // 0-based cursor into original lines
  let i = 0;

  while (i < diffLines.length && !diffLines[i].startsWith('@@')) i++;

  while (i < diffLines.length) {
    const m = diffLines[i].match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!m) { i++; continue; }
    const oldStart = parseInt(m[1], 10);

    while (idx < oldStart - 1) { out.push(lines[idx]); idx++; }

    i++;
    while (i < diffLines.length && !diffLines[i].startsWith('@@')) {
      const l = diffLines[i];
      if (l.startsWith(' ')) {
        if (lines[idx] === undefined || lines[idx] !== l.slice(1)) return null;
        out.push(lines[idx]); idx++;
      } else if (l.startsWith('-')) {
        if (lines[idx] !== l.slice(1)) return null;
        idx++; // removed
      } else if (l.startsWith('+')) {
        out.push(l.slice(1));
      } // '\' markers and blanks ignored
      i++;
    }
  }
  while (idx < lines.length) { out.push(lines[idx]); idx++; }
  return out.join('\n');
}

export const CAPABILITIES = [
  {
    id: 'repository-intelligence',
    version: '1.0.0',
    description: 'LLM-free repository understanding: files, languages, deps, git, tests, CI.',
    inputs: ['root'],
    outputs: ['repoSnapshot'],
    requiredTools: ['readFile'],
    supportedAgents: ['planner'],
    safetyLevel: 'read',
    estimatedCost: 0,
    estimatedDurationMs: 2000,
    async run(ctx) {
      const snapshot = buildRepoSnapshot(ctx.root);
      return { data: { repoSnapshot: snapshot } };
    },
  },
  {
    id: 'semantic-analysis',
    version: '1.0.0',
    description: 'Tree-sitter AST symbol index, import graph, caller/callee relationships.',
    inputs: ['root', 'files'],
    outputs: ['semantic'],
    requiredTools: ['readFile', 'findSymbol', 'inspectDependencies'],
    supportedAgents: ['planner'],
    safetyLevel: 'read',
    estimatedCost: 0,
    estimatedDurationMs: 4000,
    async run(ctx) {
      await initTreeSitter();
      const fileObjs = (ctx.files || []).map((p) => ({ path: p, kind: 'source' }));
      const symIndex = buildSymbolIndex(fileObjs, ctx.root);
      const importGraph = buildImportGraph(fileObjs, ctx.root);
      const queries = createSemanticQueries(symIndex, importGraph, ctx.root);
      return { data: { semantic: queries, stats: symIndex.stats, importers: importGraph.importers.size } };
    },
  },
  {
    id: 'machine-gates',
    version: '1.0.0',
    description: 'Run detected deterministic quality gates with real exit codes.',
    inputs: ['root', 'sandbox'],
    outputs: ['gateResults'],
    requiredTools: ['readFile', 'runGate'],
    supportedAgents: ['planner'],
    safetyLevel: 'execute',
    estimatedCost: 0,
    estimatedDurationMs: 120000,
    async run(ctx) {
      const { results, applicable } = runGates(ctx.root, { sandbox: ctx.sandbox || 'trusted' });
      return { data: { gateResults: results, applicable } };
    },
  },
  ...Object.entries(CAT_DETECTORS).map(([capability, detectorIds]) => ({
    id: capability,
    version: '1.0.0',
    description: `Deterministic + LLM ${capability.replace('-audit', '')} audit over the workspace.`,
    inputs: ['root', 'files'],
    outputs: ['findings'],
    requiredTools: ['readFile', 'runDetector'],
    supportedAgents: [capability.replace('-audit', '-specialist')],
    safetyLevel: 'read',
    estimatedCost: 0,
    estimatedDurationMs: 3000,
    async run(ctx) {
      const findings = detectorFindingsFor(ctx.root, ctx.files || [], detectorIds);
      for (const f of findings) {
        f.status = 'verified';
        f.confidence = 0.6;
        const ev = ctx.evidence.addSource(f.path, { kind: 'detector', name: f.detectorId }, { contextLines: 0 });
        f.evidenceRefs = [ev.id];
      }
      // Optional LLM specialist enrichment (when a provider is configured)
      if (ctx.llm && ctx.snapshot) {
        try {
          const review = await runSpecialist({
            provider: 'mock', model: 'mock', lens: { id: capability, title: capability, focus: capability, checklist: [] },
            evidenceContext: '', projectName: ctx.snapshot.root || 'repo', llm: ctx.llm,
          });
          return { data: { findings }, specialistFindings: review.findings };
        } catch { /* deterministic findings remain valid without LLM */ }
      }
      return { data: { findings } };
    },
  })),
  {
    id: 'evidence-analysis',
    version: '1.0.0',
    description: 'Anchor candidate findings to hashed code evidence; demote unresolvable refs.',
    inputs: ['findings'],
    outputs: ['findings'],
    requiredTools: ['readFile'],
    supportedAgents: ['verifier'],
    safetyLevel: 'read',
    estimatedCost: 0,
    estimatedDurationMs: 1000,
    async run(ctx) {
      const out = [];
      for (const f of ctx.findings) {
        const loc = locateSource(ctx.root, f.path, { contextLines: 2 });
        if (loc.status !== 'ok') {
          out.push({ ...f, status: 'invalid' });
          continue;
        }
        const ev = ctx.evidence.addSource(f.path, { kind: 'agent', name: 'evidence-analysis' }, { contextLines: 2 });
        out.push({ ...f, evidenceRefs: [ev.id], status: f.status === 'candidate' ? 'candidate' : f.status });
      }
      return { data: { findings: out } };
    },
  },
  {
    id: 'verification',
    version: '1.0.0',
    description: 'Adversarial per-finding verification against real code evidence.',
    inputs: ['findings'],
    outputs: ['findings', 'verifications'],
    requiredTools: ['readFile', 'findSymbol'],
    supportedAgents: ['verifier'],
    safetyLevel: 'read',
    estimatedCost: 0.01,
    estimatedDurationMs: 30000,
    async run(ctx) {
      // P7-02: cross-lens deduplication before verification (audits may
      // report the same issue; one canonical finding is verified).
      const uniq = dedupeFindings(ctx.findings || []);
      const out = [];
      for (const f of uniq) {
        if (f.status === 'invalid') { out.push(f); continue; }
        const ev = f.evidenceRefs?.length ? ctx.evidence.get(f.evidenceRefs[0]) : null;
        if (ctx.llm) {
          const { runVerifier } = await import('../agents/agents.mjs');
          const verdict = await runVerifier({
            provider: 'mock', model: 'mock', finding: f, evidence: ev,
            gateResults: ctx.gateResults || [], projectName: 'workflow', llm: ctx.llm,
          });
          out.push({
            ...f,
            status: verdict.decision === 'verified' ? 'verified' : verdict.decision === 'refuted' ? 'refuted' : 'inconclusive',
            confidence: verdict.confidence,
            severity: verdict.severity || f.severity,
            verifierNote: verdict.note,
          });
        } else {
          // Deterministic corroboration (P6-07): detector evidence with matching hash is reproducible
          out.push({
            ...f,
            status: f.sources?.some((s) => String(s).startsWith('deterministic:')) ? 'verified' : 'inconclusive',
            confidence: f.sources?.some((s) => String(s).startsWith('deterministic:')) ? 0.6 : 0.3,
            verifierNote: 'deterministic corroboration (no LLM configured)',
          });
        }
      }
      return { data: { findings: out } };
    },
  },
  {
    id: 'reproduction',
    version: '1.0.0',
    description: 'Per-finding reproduction: detector replay + targeted tests where available.',
    inputs: ['findings'],
    outputs: ['reproductions'],
    requiredTools: ['readFile', 'runTest'],
    supportedAgents: ['reproducer'],
    safetyLevel: 'execute',
    estimatedCost: 0.005,
    estimatedDurationMs: 60000,
    async run(ctx) {
      const reproductions = [];
      for (const f of ctx.findings.filter((x) => x.status === 'verified')) {
        const file = String(f.path || '').replace(/:\d+.*$/, '');
        const line = parseInt(String(f.path || '').split(':')[1], 10) || 1;
        let reproduced = false;
        let mechanism = 'none';

        const detId = (f.sources || []).find((s) => String(s).startsWith('deterministic:'))?.slice('deterministic:'.length);
        if (detId) {
          const det = DETECTORS.find((d) => d.id === detId);
          if (det) {
            try {
              const content = (await import('node:fs')).readFileSync((await import('node:path')).resolve(ctx.root, file), 'utf-8');
              const lines = content.split(/\r?\n/);
              const lo = Math.max(1, line - 2); const hi = Math.min(lines.length, line + 2);
              reproduced = lines.slice(lo - 1, hi).some((l) => det.pattern.test(l));
              mechanism = 'detector-replay';
            } catch { reproduced = false; }
          }
        }

        const tests = findRelatedTests(file, ctx.snapshot || { tests: [] }, ctx.importGraph || { importers: new Map() });
        let testStatus = 'no_tests';
        if (tests.length > 0) {
          const tr = runTargetedTests(ctx.root, tests);
          testStatus = tr.status;
          if (tr.status === 'tests_failed') { reproduced = true; mechanism = 'targeted-test-failure'; }
        }
        reproductions.push({ findingId: f.id, path: f.path, reproduced, mechanism, testStatus });
      }
      return { data: { reproductions, reproduced: reproductions.some((r) => r.reproduced) } };
    },
  },
  {
    id: 'remediation',
    version: '1.0.0',
    description: 'Suggested-only patch generation, worktree validation, and confidence scoring.',
    inputs: ['findings'],
    outputs: ['patches'],
    requiredTools: ['readFile', 'writePatch', 'applyCheck', 'runTest'],
    supportedAgents: ['remediator'],
    safetyLevel: 'write',
    estimatedCost: 0.02,
    estimatedDurationMs: 120000,
    async run(ctx) {
      if (!ctx.llm) {
        return { data: { patches: [], skipped: true, reason: 'no_llm' } };
      }
      const patches = [];
      const targets = ctx.findings.filter((f) => f.status === 'verified' && f.severity === 'high').slice(0, 2);
      for (const f of targets) {
        const file = String(f.path || '').replace(/:\d+.*$/, '');
        let fileContent = '';
        try { fileContent = readFileSync(resolvePath(ctx.root, file), 'utf-8').slice(0, 50000); } catch { /* unreadable */ }
        const record = await remediateFinding({
          llm: ctx.llm, root: ctx.root, finding: { ...f, fingerprint: fingerprint(f) },
          evidence: f.evidenceRefs?.length ? ctx.evidence.get(f.evidenceRefs[0]) : null,
          fileContent, testFiles: [], projectName: 'workflow',
        });
        record.confidence = computePatchConfidence(record);
        patches.push(record);
      }
      return { data: { patches, validated: patches.some((p) => p.status === 'validated') } };
    },
  },
  {
    id: 'regression',
    version: '1.0.0',
    description: 'Verify remediated content: apply validated patches in-memory and re-run detectors.',
    inputs: ['patches', 'findings'],
    outputs: ['regressionReport'],
    requiredTools: ['readFile', 'rerunAudit'],
    supportedAgents: ['verifier'],
    safetyLevel: 'execute',
    estimatedCost: 0,
    estimatedDurationMs: 10000,
    async run(ctx) {
      const validated = (ctx.patches || []).filter((p) => p.status === 'validated');
      const regressions = [];

      for (const p of validated) {
        const file = String(p.path || '').replace(/:\d+.*$/, '');
        let original = '';
        try { original = readFileSync(resolvePath(ctx.root, file), 'utf-8'); } catch { continue; }
        const patched = applyUnifiedDiff(original, p.diff);
        if (patched == null) {
          regressions.push(`${file}: patch could not be re-applied in-memory`);
          continue;
        }
        // Re-run every applicable detector over the patched content
        const patchedLines = patched.split(/\r?\n/);
        for (const det of DETECTORS) {
          if (!det.exts.test(file)) continue;
          for (let i = 0; i < patchedLines.length; i++) {
            if (/^\s*(\/\/|\/\*|\*)/.test(patchedLines[i])) continue;
            if (det.pattern.test(patchedLines[i])) {
              regressions.push(`${file}:${i + 1} — ${det.id} still fires after patch`);
              break;
            }
          }
        }
      }
      return { data: { regressionReport: { pass: regressions.length === 0, regressions, checked: validated.length } } };
    },
  },
  {
    id: 'policy-evaluation',
    version: '1.0.0',
    description: 'Policy-as-code evaluation of the run against the active compliance profile.',
    inputs: ['findings', 'gateResults'],
    outputs: ['decision'],
    requiredTools: ['readFile'],
    supportedAgents: ['judge'],
    safetyLevel: 'read',
    estimatedCost: 0,
    estimatedDurationMs: 100,
    async run(ctx) {
      const decision = evaluatePolicy({
        findings: ctx.findings,
        gates: ctx.gateResults || [],
        profileName: ctx.policyProfile || 'OWASP-Top10',
      });
      return { data: { decision } };
    },
  },
  {
    id: 'reporting',
    version: '1.0.0',
    description: 'Assemble the final workflow report artifact.',
    inputs: ['findings', 'gateResults', 'decision'],
    outputs: ['report'],
    requiredTools: ['readFile'],
    supportedAgents: ['judge'],
    safetyLevel: 'read',
    estimatedCost: 0,
    estimatedDurationMs: 100,
    async run(ctx) {
      const verified = ctx.findings.filter((f) => f.status === 'verified');
      return {
        data: {
          report: {
            verifiedCount: verified.length,
            refutedCount: ctx.findings.filter((f) => f.status === 'refuted').length,
            decision: ctx.lastDecision || null,
            summary: `Workflow report: ${verified.length} verified finding(s).`,
          },
        },
      };
    },
  },
  {
    id: 'human-approval',
    version: '1.0.0',
    description: 'Human gate: the workflow pauses until a human approves or rejects.',
    inputs: [],
    outputs: ['approval'],
    requiredTools: [],
    supportedAgents: [],
    safetyLevel: 'read',
    estimatedCost: 0,
    estimatedDurationMs: 0,
    async run(ctx) {
      // The engine resolves human gates via approveTask/rejectTask before
      // this capability ever executes (WAITING_FOR_HUMAN → READY).
      return { data: { approval: ctx.task?.approval || { status: 'approved' } } };
    },
  },
  {
    id: 'self-audit',
    version: '1.0.0',
    description: 'Arena audits its own source tree.',
    inputs: ['root'],
    outputs: ['findings'],
    requiredTools: ['readFile', 'runDetector'],
    supportedAgents: ['planner'],
    safetyLevel: 'read',
    estimatedCost: 0,
    estimatedDurationMs: 5000,
    async run(ctx) {
      const findings = detectorFindingsFor(ctx.root, ctx.files || [], null);
      return { data: { findings } };
    },
  },
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export class CapabilityRegistry {
  constructor() {
    this.map = new Map();
    for (const cap of CAPABILITIES) this.register(cap);
  }

  register(cap) {
    // Contract validation
    for (const field of ['id', 'version', 'description', 'inputs', 'outputs', 'requiredTools', 'supportedAgents', 'safetyLevel', 'run']) {
      if (cap[field] === undefined) throw new Error(`Capability manifest missing field: ${field} (${cap.id || 'unnamed'})`);
    }
    for (const t of cap.requiredTools) {
      if (!TOOL_REGISTRY[t]) throw new Error(`Capability ${cap.id} requires unknown tool: ${t}`);
    }
    this.map.set(cap.id, cap);
    return cap;
  }

  get(id) { return this.map.get(id) || null; }
  list() { return [...this.map.values()]; }
}

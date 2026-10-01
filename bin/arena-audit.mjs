#!/usr/bin/env node

/**
 * Arena Audit CLI v2 — Evidence-Anchored Multi-Agent Tournament Auditor
 *
 * Architecture (Phase 0..9 of the roadmap):
 *   Repository Intelligence → Deterministic Gates → Evidence Engine
 *   → Parallel Specialists (real code context) → Evidence-Anchored Verifiers
 *   → Finding Intelligence (fingerprint/dedupe) → Scoring 2.0
 *   → Interactive HTML dashboard + Markdown + JSON + audit-run manifest
 *
 * Zero external npm dependencies. Node >= 18.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { createAuditRun, validateFinding } from '../src/core/schemas.mjs';
import { runPool } from '../src/core/concurrency.mjs';
import { buildRepoSnapshot } from '../src/intake/repo-snapshot.mjs';
import { EvidenceStore, locateSource, isStale } from '../src/evidence/evidence-store.mjs';
import { runGates, normalizeGateResult } from '../src/gates/registry.mjs';
import { planLenses, buildEvidenceContext, runSpecialist, runVerifier, runJudge } from '../src/agents/agents.mjs';
import { detectProvider, callLLM } from '../src/agents/llm.mjs';
import { dedupeFindings, computeScores } from '../src/findings/findings.mjs';
import { sandboxPosture } from '../src/sandbox/policy.mjs';
import { generateDashboardHtml } from '../src/dashboard.mjs';
import { buildSymbolIndex, buildImportGraph, createSemanticQueries } from '../src/semantic/symbols.mjs';
import { initTreeSitter } from '../src/semantic/ast.mjs';
import { scopeFiles, gitDiffText } from '../src/git/delta.mjs';
import { findRelatedTests, runTargetedTests } from '../src/verification/reproduce.mjs';
import { toSarif } from '../src/outputs/sarif.mjs';
import { remediateFinding } from '../src/remediation/patch.mjs';
import { computePatchConfidence } from '../src/remediation/confidence.mjs';
import { runDetectors } from '../src/detectors/detectors.mjs';
import { createTelemetry } from '../src/observability/telemetry.mjs';
import { enforceTrustInvariants } from '../src/core/trust-gate.mjs';
import { buildBaseline, saveBaseline, loadBaseline, classifyAgainstBaseline } from '../src/findings/baseline.mjs';
import {
  decideConclusion, buildCheckPayload, buildPrComment,
  createCheckRun, upsertPrComment, prNumberFromEnv,
} from '../src/integrations/github.mjs';

// ── Control Plane subcommand (P15) ──
async function serveMain(argv) {
  const { JsonStore } = await import('../src/server/store.mjs');
  const { createControlPlane } = await import('../src/server/api.mjs');
  const { dashboardHtml } = await import('../src/server/dashboard.mjs');
  let port = 7788, host = '127.0.0.1', storePath = resolve(process.cwd(), 'arena-control-plane.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = parseInt(argv[++i], 10) || 7788;
    else if (argv[i] === '--store') storePath = resolve(process.cwd(), argv[++i]);
    else if (argv[i] === '--host') host = argv[++i];
  }
  const token = process.env.ARENA_API_TOKEN || null;
  const store = new JsonStore(storePath);
  const server = await createControlPlane(store, { token, host, port, dashboard: dashboardHtml() });
  const addr = server.address();
  console.log(`🛡️  Arena Control Plane`);
  console.log(`  API:       http://${addr.address === '::' ? 'localhost' : addr.address}:${addr.port}/api/health`);
  console.log(`  Dashboard: http://localhost:${addr.port}/`);
  console.log(`  Store:     ${storePath}`);
  console.log(`  Auth:      ${token ? 'Bearer token required' : 'none (loopback-only bind)'}`);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const ENGINE_VERSION = pkg.version || '2.0.0';

// --- Terminal Styles ---
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const color = {
  reset: isTTY ? '\x1b[0m' : '', bold: isTTY ? '\x1b[1m' : '', dim: isTTY ? '\x1b[2m' : '',
  red: isTTY ? '\x1b[31m' : '', green: isTTY ? '\x1b[32m' : '', yellow: isTTY ? '\x1b[33m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
};

function banner() {
  console.log(`
${color.cyan}${color.bold}╔══════════════════════════════════════════════════════════════════╗
║          🛡️  ARENA AUDIT v${ENGINE_VERSION.padEnd(6)} — EVIDENCE-ANCHORED ENGINE           ║
║   Repo Intelligence → Gates → Evidence → Parallel Tournament      ║
╚══════════════════════════════════════════════════════════════════╝${color.reset}
`);
}

// --- CLI ---
const args = process.argv.slice(2).filter((a) => a !== 'serve');
let targetDir = process.cwd();
let outputDir = null;
let gatesOnly = false;
let agentMode = false;
let openUi = false;
let diffBase = null;
let targetPath = null;
let doReproduce = false;
let doRemediate = false;
let saveBaselineFlag = false;
let baselinePath = null;
let githubFlag = false;
let pushUrl = null;
let maxConcurrency = 4;
let sandbox = 'trusted';
let provider = process.env.ARENA_PROVIDER || null;
let modelName = process.env.ARENA_MODEL || null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
  else if (arg === '--gates-only') gatesOnly = true;
  else if (arg === '--agent-mode') agentMode = true;
  else if (arg === '--ui' || arg === '--open') openUi = true;
  else if (arg === '--diff') diffBase = args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : null;
  else if (arg === '--target') targetPath = args[++i];
  else if (arg === '--reproduce') doReproduce = true;
  else if (arg === '--remediate') doRemediate = true;
  else if (arg === '--save-baseline') saveBaselineFlag = true;
  else if (arg === '--baseline') {
    baselinePath = args[i + 1] && !args[i + 1].startsWith('-') ? resolve(process.cwd(), args[++i]) : resolve(targetDir, 'arena-baseline.json');
  }
  else if (arg === '--github') githubFlag = true;
  else if (arg === '--push') pushUrl = args[++i];
  else if (arg === '--sandbox') {
    const val = args[++i];
    sandbox = ['trusted', 'untrusted', 'docker'].includes(val) ? val : 'trusted';
  }
  else if (arg === '--concurrency' || arg === '-c') maxConcurrency = Math.max(1, Math.min(16, parseInt(args[++i], 10) || 4));
  else if (arg === '--output' || arg === '-o') outputDir = resolve(process.cwd(), args[++i]);
  else if (arg === '--provider' || arg === '-p') provider = args[++i];
  else if (arg === '--model' || arg === '-m') modelName = args[++i];
  else if (!arg.startsWith('-')) targetDir = resolve(process.cwd(), arg);
}

if (!outputDir) outputDir = resolve(targetDir, 'arena-audit-out');

function printHelp() {
  console.log(`
Usage:
  npx arena-audit [path] [options]            run an audit
  npx arena-audit serve [--port] [--store]    start the control plane
  npx arena-audit patches [--out dir]         list suggested patches + approval state
  npx arena-audit approve <id> [--out dir] [--approver n] [--force]
  npx arena-audit reject <id> [--out dir] [--reason text]

Arguments:
  path                    Directory to audit (default: current directory)

Options:
  --gates-only            Only detect and run machine quality gates, then exit
  --agent-mode            Generate tournament manifests for the host AI agent
  --diff [ref]            Diff-aware audit: only files changed vs ref (default: working tree vs HEAD)
  --target <path>         Targeted audit: only a subtree (e.g. --target src/payments)
  --reproduce             After verification, run related tests for verified findings (targeted test runner)
  --remediate             Generate SUGGESTED patches for top verified findings, validated in an isolated git worktree (never auto-applied)
  --save-baseline         Write arena-baseline.json from this run's verified/inconclusive findings
  --baseline [path]       Compare against a baseline: findings labeled new/known; fixed fingerprints reported
  --github                Post GitHub Check Run + idempotent PR comment (needs GITHUB_TOKEN, GITHUB_REPOSITORY)
  --push <url>            Ingest this run into an Arena Control Plane (POST /api/ingest)
  --ui, --open            Open the interactive HTML dashboard in the browser
  --sandbox <mode>        trusted (default) | untrusted (refuses tool execution)
  -c, --concurrency <n>   Max parallel specialist agents (default 4)
  -o, --output <dir>      Output directory (default: ./arena-audit-out)
  -p, --provider <p>      openai | anthropic | gemini | deepseek | ollama
  -m, --model <name>      Override default model name
  -h, --help              Show this help

Environment Variables:
  ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY
  OLLAMA_HOST             Local Ollama endpoint
  ARENA_TRUST_REPO=1      Explicit trust override for untrusted mode
`);
}

function openInBrowser(p) {
  try {
    if (process.platform === 'win32') spawnSync('cmd.exe', ['/c', 'start', '""', p], { stdio: 'ignore' });
    else if (process.platform === 'darwin') spawnSync('open', [p], { stdio: 'ignore' });
    else spawnSync('xdg-open', [p], { stdio: 'ignore' });
  } catch { /* headless environment */ }
}

// --- Main ---
async function main() {
  banner();
  if (!existsSync(targetDir)) {
    console.error(`${color.red}Target directory does not exist: ${targetDir}${color.reset}`);
    process.exit(1);
  }
  const mode = gatesOnly ? 'gates-only' : (agentMode ? 'agent-assisted' : 'full');
  const run = createAuditRun({
    engineVersion: ENGINE_VERSION, mode,
    provider: detectProvider(provider), model: modelName,
    repository: basename(targetDir),
  });
  const telemetry = createTelemetry(run.runId);
  // Instrumented LLM: every provider call becomes a telemetry span.
  const instrumentedLlm = (system, prompt) => {
    const span = telemetry.start('llm', 'provider-call');
    return callLLM(detectProvider(provider), system, prompt, { model: modelName })
      .then((r) => { span.end('ok'); return r; })
      .catch((e) => { span.end('error', { message: e.message }); throw e; });
  };

  console.log(`Target:   ${color.cyan}${targetDir}${color.reset}`);
  console.log(`Run ID:   ${color.cyan}${run.runId}${color.reset}`);
  console.log(`Sandbox:  ${color.cyan}${sandbox}${color.reset} (secrets stripped from child envs)\n`);

  mkdirSync(outputDir, { recursive: true });

  // ── Phase 1: Repository Intelligence (deterministic, no LLM) ──
  console.log(`${color.bold}[1/6] 🧭 Repository Intelligence${color.reset}`);
  const snapshot = buildRepoSnapshot(targetDir);
  console.log(`  ${snapshot.fileCount} files · langs: ${snapshot.languages.slice(0, 3).map((l) => l.language).join(', ') || 'n/a'} · tests: ${snapshot.tests.length} · pm: ${snapshot.packageManager}`);
  run.commit = snapshot.git?.head || null;

  // ── Phase 1b: Semantic layer (P4) — AST + heuristic symbol & import graph ──
  await initTreeSitter();
  const symIndex = buildSymbolIndex(snapshot.allFiles, targetDir);
  const importGraph = buildImportGraph(snapshot.allFiles, targetDir);
  const semantic = createSemanticQueries(symIndex, importGraph, targetDir);
  const astTag = symIndex.stats ? ` (${symIndex.stats.astParsed} AST, ${symIndex.stats.fallbackParsed} fallback)` : '';
  console.log(`  semantic: ${symIndex.symbols.size} symbols indexed${astTag} · ${importGraph.importers.size} files with importers`);

  // ── Phase 1c: Audit scope (P11) — full | diff | target ──
  const auditMode = diffBase !== null || args.includes('--diff') ? 'diff' : (targetPath ? 'target' : 'full');
  run.mode = auditMode === 'full' && gatesOnly ? 'gates-only' : auditMode;
  const { scopedFiles, scopeNote, delta } = scopeFiles(targetDir, snapshot, auditMode, { base: diffBase, target: targetPath });
  if (auditMode !== 'full') console.log(`  scope: ${scopeNote}`);
  const diffText = auditMode === 'diff' && delta?.available ? gitDiffText(targetDir, diffBase) : null;

  // ── Phase 2: Deterministic Gates ──
  console.log(`\n${color.bold}[2/6] 🚦 Deterministic Gates${color.reset}`);
  const gateSpan = telemetry.start('phase', 'gates');
  const gateOutput = runGates(targetDir, { sandbox, onResult: (g) => telemetry.timed('gate', g.id, g.durationMs, { status: g.status }) });
  const gateResults = gateOutput.results;
  const notAvail = ['typecheck', 'lint', 'test', 'semgrep', 'gitleaks']
    .filter((id) => !gateOutput.applicable.includes(id))
    .map((id) => normalizeGateResult({ id, status: 'not_available', detail: 'tool not detected in this repository' }));
  const allGates = [...gateResults, ...notAvail];
  gateSpan.end('ok', { ran: gateResults.length, detected: gateOutput.applicable.length });
  for (const g of gateResults) {
    const tag = g.status === 'pass' ? `${color.green}PASS ✓${color.reset}` : `${color.red}FAIL ✗${color.reset}`;
    console.log(`  ${g.id.padEnd(12)} ${tag} (${(g.durationMs / 1000).toFixed(1)}s)`);
  }
  if (gateResults.length === 0) {
    console.log(`  ${color.dim}No machine gates detected — they will be reported as NOT_AVAILABLE, never as a pass.${color.reset}`);
  }

  const evidence = new EvidenceStore(targetDir, run.commit);

  // ── Phase 2b: Deterministic Detectors (P4 gate) — real findings, zero LLM ──
  const detSpan = telemetry.start('phase', 'detectors');
  const detFiles = auditMode === 'full' ? snapshot.allFiles : scopedFiles;
  const detFindings = runDetectors(targetDir, detFiles.map((f) => ({ path: f.path, kind: f.kind })));
  for (const d of detFindings) {
    const ev = evidence.addSource(d.path, { kind: 'detector', name: d.detectorId }, { contextLines: 0 });
    d.evidenceRefs = [ev.id];
    // Deterministic tool evidence is reproducible by rerunning the detector
    // (P6-07 corroboration) — labeled verified with conservative confidence.
    d.status = 'verified';
    d.confidence = 0.6;
  }
  detSpan.end('ok', { findings: detFindings.length });
  if (detFindings.length > 0) {
    console.log(`  ${color.cyan}detectors: ${detFindings.length} deterministic finding(s)${color.reset}`);
  }

  // Gates-only mode: LLM-free audit (gates + detectors) still produces everything.
  if (gatesOnly) {
    const scores = computeScores(allGates, detFindings);
    finishRun({ run, root: targetDir, snapshot, gates: allGates, findings: detFindings, evidence: evidence.toJSON(), scores, outputDir, lenses: [], sandbox, telemetry, scopeNote, delta, symIndex, importGraph });
    if (openUi) openInBrowser(join(outputDir, 'index.html'));
    console.log(`\n${color.green}Gates-only audit complete — ${detFindings.length} deterministic finding(s).${color.reset}`);
    return;
  }

  const activeProvider = detectProvider(provider);

  // ── Agent-assisted mode: manifest for the host AI harness ──
  if (!activeProvider || agentMode) {
    console.log(`\n${color.yellow}[Agent-Assisted Mode]${color.reset} No LLM key detected (or --agent-mode).`);
    console.log('Writing tournament manifests + instructions + dashboard for your host AI agent...');
    const docsContext = readDocs(targetDir);
    const scores = computeScores(allGates, detFindings);
    const instructions = [
      `# Arena Tournament Audit Instructions`,
      ``,
      `Target: **${basename(targetDir)}** · Run: ${run.runId} · Engine: v${ENGINE_VERSION}`,
      ``,
      `## Machine gates (real exit codes)`,
      ...allGates.map((g) => `- **${g.id}**: ${g.status}`),
      ``,
      `## Deterministic detector findings already anchored (${detFindings.length})`,
      ...detFindings.slice(0, 10).map((d) => `- \`${d.path}\` — ${d.problem}`),
      detFindings.length > 10 ? `- …and ${detFindings.length - 10} more (see audit-run.json)` : '',
      ``,
      `## Protocol`,
      `1. Plan 4-7 audit lenses from AGENTS.md/CLAUDE.md/README.`,
      `2. For each lens, review the code with citations path:line.`,
      `3. For EVERY finding, independently re-read the cited lines and confirm/refute it.`,
      `4. Merge via fingerprint dedupe; judge prioritizes verified findings only.`,
      `5. Update ${join(outputDir, 'index.html')} and ${join(outputDir, 'REPORT.md')}.`,
      ``,
      `Repo facts: ${snapshot.fileCount} files, languages ${JSON.stringify(snapshot.languages.slice(0, 4))}, ${snapshot.dependencies.count} dependencies.`,
    ].join('\n');
    writeFileSync(join(outputDir, 'agent-instructions.md'), instructions, 'utf-8');
    writeFileSync(join(outputDir, 'tournament-manifest.json'), JSON.stringify({ run, snapshot: { ...snapshot, sampleSourceFiles: snapshot.sampleSourceFiles.slice(0, 50) } }, null, 2), 'utf-8');

    finishRun({ run, root: targetDir, snapshot, gates: allGates, findings: detFindings, evidence: evidence.toJSON(), scores, outputDir, lenses: [], sandbox, telemetry });
    if (openUi) openInBrowser(join(outputDir, 'index.html'));
    console.log(`\n${color.green}✓ agent-instructions.md + tournament-manifest.json + index.html written.${color.reset}`);
    console.log(`  Tell your AI assistant: "Read ${join(outputDir, 'agent-instructions.md')} and run the tournament."`);
    return;
  }

  // ── Phase 3: Lens Planning ──
  console.log(`\n${color.bold}[3/6] 🗺️  Lens Planning (provider: ${activeProvider})${color.reset}`);
  const docsContext = readDocs(targetDir);
  const plan = await planLenses({ provider: activeProvider, model: modelName, snapshot, docsContext, llm: instrumentedLlm });
  const projectName = plan.projectName || snapshot.dependencies.projectName || basename(targetDir);
  console.log(`  ${plan.lenses.length} lenses (${plan.source}) for "${projectName}"`);

  // ── Phase 4+5: Parallel Specialists → Evidence-Anchored Verifiers ──
  console.log(`\n${color.bold}[4/6] ⚔️  Parallel Specialists (concurrency: ${maxConcurrency})${color.reset}`);
  const specialistResults = await runPool(plan.lenses, async (lens) => {
    const span = telemetry.start('agent', `specialist:${lens.id}`);
    const context = buildEvidenceContext({
      snapshot, files: scopedFiles.slice(0, 2000),
      locateSourceFn: (ref, opts) => locateSource(targetDir, ref, opts),
      lens, semantic, diffText,
    });
    try {
      const review = await runSpecialist({ provider: activeProvider, model: modelName, lens, evidenceContext: context, projectName, llm: instrumentedLlm });
      span.end('ok', { candidates: review.findings.length });
      return { lens, review };
    } catch (e) {
      span.end('error', { message: e.message });
      throw e;
    }
  }, { maxConcurrency, onSettled: (r) => {
    if (r.ok) console.log(`  ${color.green}✓${color.reset} ${r.value.lens.title}: ${r.value.review.findings.length} candidate(s)`);
    else console.log(`  ${color.red}✗${color.reset} lens failed: ${r.error.message}`);
  } });

  const candidates = [];
  const healthNotes = [];
  for (const r of specialistResults) {
    if (!r.ok) continue;
    healthNotes.push({ lens: r.value.lens.title, note: r.value.review.healthNote });
    for (const f of r.value.review.findings) {
      const check = validateFinding({ ...f, lens: r.value.lens.title, id: 'tmp' });
      if (!check.ok) continue; // malformed finding never enters the pipeline
      candidates.push({ ...f, lens: r.value.lens.title, status: 'candidate' });
    }
  }

  // ── Evidence resolution: anchor every candidate to real code ──
  console.log(`\n${color.bold}[5/6] 🔍 Evidence Anchoring + Independent Verification${color.reset}`);
  const verifiedOut = await runPool(candidates, async (f) => {
    const loc = locateSource(targetDir, f.path, { contextLines: 4 });
    let ev;
    if (loc.status === 'ok') {
      ev = evidence.addSource(f.path, { kind: 'agent', name: 'specialist', lens: f.lens }, { contextLines: 4 });
    } else {
      ev = { id: `ev_err_${Math.random().toString(36).slice(2, 8)}`, type: 'error', status: loc.status, ref: f.path, createdAt: new Date().toISOString() };
      evidence.map.set(ev.id, ev);
    }
    const anchored = { ...f, evidenceRefs: [ev.id], path: f.path };
    if (loc.status !== 'ok') {
      telemetry.timed('agent', 'verifier:skipped-invalid', 0, { path: f.path, status: loc.status });
      return { ...anchored, status: 'invalid', confidence: 0, verifierNote: `Evidence resolution failed: ${loc.status}` };
    }
    const vSpan = telemetry.start('agent', 'verifier');
    const verdict = await runVerifier({
      provider: activeProvider, model: modelName,
      finding: anchored, evidence: ev, gateResults, projectName, llm: instrumentedLlm,
    });
    vSpan.end('ok', { decision: verdict.decision, confidence: verdict.confidence });
    return {
      ...anchored,
      status: verdict.decision === 'verified' ? 'verified' : verdict.decision === 'refuted' ? 'refuted' : 'inconclusive',
      severity: verdict.severity,
      confidence: verdict.confidence,
      verifierNote: verdict.note,
    };
  }, { maxConcurrency, onSettled: (r) => {
    if (r.ok) {
      const f = r.value;
      const icon = f.status === 'verified' ? `${color.green}VERIFIED ✓${color.reset}` : f.status === 'refuted' ? `${color.yellow}refuted${color.reset}` : f.status === 'invalid' ? `${color.red}invalid${color.reset}` : `${color.dim}inconclusive${color.reset}`;
      console.log(`  ${icon} ${f.path} — ${String(f.problem).slice(0, 60)}`);
    } else {
      console.log(`  ${color.red}✗ verification error: ${r.error.message}${color.reset}`);
    }
  } });

  let findings = [...detFindings, ...verifiedOut.filter((r) => r.ok).map((r) => r.value)];

  // ── Scope filter (P11): in diff/target mode, out-of-scope findings are dropped
  //    but counted honestly — and importers (impact) stay in scope.
  let scopeDropped = 0;
  if (auditMode !== 'full') {
    const scopeSet = new Set(scopedFiles.map((f) => f.path));
    // Impact expansion: direct importers of changed files remain in scope.
    for (const f of scopedFiles) for (const imp of semantic.importedBy(f.path)) scopeSet.add(imp);
    const inScope = [];
    for (const f of findings) {
      const file = String(f.path || '').replace(/:\d+.*$/, '');
      if (scopeSet.has(file)) inScope.push(f);
      else scopeDropped++;
    }
    findings = inScope;
    if (scopeDropped > 0) console.log(`  ${color.dim}${scopeDropped} finding(s) outside the audit scope were dropped.${color.reset}`);
  }

  // ── Phase: Finding Intelligence — fingerprint + dedupe ──
  findings = dedupeFindings(findings);

  // ── Phase: Baseline classification (P14) — new vs known vs fixed ──
  let baselineSummary = { mode: 'none' };
  if (baselinePath) {
    const baseline = loadBaseline(baselinePath);
    if (!baseline) {
      console.log(`\n${color.yellow}[Baseline] no baseline file at ${baselinePath} — treating everything as new.${color.reset}`);
    } else if (baseline.corrupt) {
      console.log(`\n${color.red}[Baseline] corrupt/unrecognized baseline (${baseline.reason}) — skipping comparison.${color.reset}`);
      baselineSummary = { mode: 'corrupt', reason: baseline.reason };
    } else {
      const cls = classifyAgainstBaseline(findings, baseline);
      baselineSummary = {
        mode: 'compared', path: baselinePath, baselineRunId: baseline.runId, baselineScope: baseline.scope,
        newCount: cls.new.length, knownCount: cls.known.length, fixedCount: cls.fixed.length,
      };
      console.log(`\n${color.bold}[📌 Baseline vs ${baseline.runId}]${color.reset} new: ${color.cyan}${cls.new.length}${color.reset} · known: ${cls.known.length} · fixed: ${color.green}${cls.fixed.length}${color.reset}`);
    }
  }

  // ── Reproduction (P6-04/05): targeted tests for verified findings (opt-in) ──
  if (doReproduce && findings.some((f) => f.status === 'verified')) {
    console.log(`\n${color.bold}[5b] 🧪 Reproduction — targeted tests for verified findings${color.reset}`);
    const byFile = new Map();
    for (const f of findings.filter((x) => x.status === 'verified')) {
      const file = String(f.path || '').replace(/:\d+.*$/, '');
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(f);
    }
    const testsToRun = new Set();
    for (const file of byFile.keys()) {
      for (const t of findRelatedTests(file, snapshot, importGraph)) testsToRun.add(t);
    }
    if (testsToRun.size === 0) {
      console.log(`  ${color.dim}no related test files found for verified findings — not_reproducible (honest state).${color.reset}`);
      for (const f of findings.filter((x) => x.status === 'verified')) f.reproduction = { status: 'not_reproducible', reason: 'no related tests' };
    } else {
      console.log(`  running ${testsToRun.size} related test file(s)...`);
      const rep = runTargetedTests(targetDir, [...testsToRun]);
      console.log(`  ${rep.status === 'tests_passed' ? color.green : color.yellow}${rep.status}${color.reset} (${rep.command || 'n/a'})`);
      const ev = evidence.addCommand(rep.command || 'targeted-tests', rep.output);
      for (const f of findings.filter((x) => x.status === 'verified')) {
        f.reproduction = { status: rep.status, evidenceRef: ev.id };
        f.evidenceRefs = [...(f.evidenceRefs || []), ev.id];
      }
    }
  }

  // ── Phase 6: Judge ──
  console.log(`\n${color.bold}[6/6] ⚖️  Principal Judge${color.reset}`);
  let judge = { verdict: 'Audit completed.', priorities: [] };
  try {
    judge = await runJudge({ provider: activeProvider, model: modelName, gateResults: allGates, findings, healthNotes, llm: instrumentedLlm });
    console.log(`  ${color.dim}${judge.verdict.slice(0, 140)}…${color.reset}`);
  } catch (e) {
    console.log(`  ${color.yellow}judge unavailable: ${e.message}${color.reset}`);
  }

  // ── Phase: Remediation (P13) — suggested patches, worktree-validated ──
  let remediation = [];
  if (doRemediate) {
    const verified = findings.filter((f) => f.status === 'verified' && f.evidenceRefs?.length).slice(0, 3);
    if (!activeProvider) {
      console.log(`\n${color.yellow}[Remediation] skipped — needs an LLM provider key.${color.reset}`);
    } else if (verified.length === 0) {
      console.log(`\n${color.dim}[Remediation] no verified findings eligible for patch suggestions.${color.reset}`);
    } else {
      console.log(`\n${color.bold}[6b] 🩺 Remediation — suggested patches for ${verified.length} verified finding(s)${color.reset}`);
      for (const f of verified) {
        const file = String(f.path || '').replace(/:\d+.*$/, '');
        let fileContent = null;
        try { fileContent = readFileSync(resolve(targetDir, file), 'utf-8').slice(0, 100000); } catch { /* unreadable */ }
        const testFiles = findRelatedTests(file, snapshot, importGraph);
        const record = await remediateFinding({
          llm: (system, prompt) => callLLM(activeProvider, system, prompt, { model: modelName }),
          root: targetDir, finding: f, evidence: evidence.get(f.evidenceRefs[0]),
          fileContent, testFiles, projectName,
        });
        remediation.push(record);
        record.confidence = computePatchConfidence(record);
        f.patchId = record.id;
        const icon = record.status === 'validated' ? `${color.green}validated ✓${color.reset}`
          : record.status === 'test_failed' ? `${color.yellow}test_failed${color.reset}`
          : `${color.red}${record.status}${color.reset}`;
        console.log(`  ${icon} ${record.id} → ${file} · confidence ${record.confidence.confidence}${record.confidence.recommended ? ' (recommended)' : ' (NOT recommended)'}`);
        for (const factor of record.confidence.factors) {
          console.log(`      ${factor.met ? '✓' : '✗'} ${factor.key} (w=${factor.weight}) — ${factor.detail}`);
        }
      }
    }
  }

  const scores = computeScores(allGates, findings);
  finishRun({ run, root: targetDir, snapshot, gates: allGates, findings, evidenceStore: evidence, evidence: evidence.toJSON(), scores, outputDir, lenses: plan.lenses, judge, projectName, sandbox,
    scopeNote, delta, scopeDropped, symIndex, importGraph, remediation, telemetry, baselineSummary });

  // ── Baseline save (P14-04) ──
  if (saveBaselineFlag) {
    const baselineOut = buildBaseline({ findings, runId: run.runId, scope: run.mode, commit: run.commit });
    const path = saveBaseline(resolve(outputDir, 'arena-baseline.json'), baselineOut);
    console.log(`  📌 Baseline saved: ${color.cyan}${path}${color.reset} (${baselineOut.fingerprints.length} fingerprints)`);
  }

  // ── GitHub integration (P12-02/04): check run + idempotent PR comment ──
  if (githubFlag && process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    const newFindings = findings.filter((f) => f.status === 'verified' && f.baselineState === 'new');
    const knownCount = findings.filter((f) => f.status === 'verified' && f.baselineState === 'known').length;
    const conclusion = decideConclusion({ gates: allGates, findings, coverage: scores.coverage });
    const runMeta = { runId: run.runId, mode: run.mode, commit: process.env.GITHUB_SHA || run.commit };
    try {
      await createCheckRun({
        token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY,
        payload: buildCheckPayload({ conclusion, scores, newVerified: newFindings.length, knownVerified: knownCount, gates: allGates, runMeta }),
      });
      console.log(`  ☁️ GitHub check posted (${conclusion}).`);
    } catch (e) {
      console.log(`  ${color.yellow}GitHub check failed: ${e.message}${color.reset}`);
    }
    const pr = prNumberFromEnv();
    if (pr) {
      try {
        await upsertPrComment({
          token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY, prNumber: pr,
          body: buildPrComment({
            runMeta, scores, coverage: scores.coverage, gates: allGates,
            newFindings, knownCount, fixedCount: baselineSummary.fixedCount || 0,
            priorities: judge?.priorities || [],
          }),
        });
        console.log(`  💬 PR #${pr} comment updated.`);
      } catch (e) {
        console.log(`  ${color.yellow}PR comment failed: ${e.message}${color.reset}`);
      }
    }
  }

  console.log(`\n${color.green}${color.bold}🎉 Audit Complete — ${scores.overall ?? 'N/A'}/100 (coverage ${scores.coverage.percent}%)${color.reset}`);
  for (const line of scores.explanations) console.log(`  ${color.dim}· ${line}${color.reset}`);
  console.log(`  🌐 Dashboard:   ${color.cyan}${join(outputDir, 'index.html')}${color.reset}`);
  console.log(`  📄 Report:      ${color.cyan}${join(outputDir, 'REPORT.md')}${color.reset}`);
  console.log(`  📦 Manifest:    ${color.cyan}${join(outputDir, 'audit-run.json')}${color.reset}`);

  // ── Control Plane push (P15) ──
  if (pushUrl) {
    try {
      const resp = await fetch(pushUrl.replace(/\/$/, '') + '/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.ARENA_API_TOKEN ? { Authorization: `Bearer ${process.env.ARENA_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          project: { name: projectName || run.repository, repository: snapshot.git?.remoteUrl || null },
          audit: {
            run, gates: allGates, findings,
            scores, lensSummary: lenses.map((l) => ({ id: l.id, title: l.title })),
          },
        }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || resp.status);
      console.log(`  ☁️ Pushed to control plane: run ${out.runId} (${out.findingsIngested} findings${out.created ? '' : ', duplicate'})`);
    } catch (e) {
      console.log(`  ${color.yellow}Control plane push failed: ${e.message}${color.reset}`);
    }
  }

  if (openUi) openInBrowser(join(outputDir, 'index.html'));
}

function readDocs(root) {
  let out = '';
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'package.json']) {
    const p = resolve(root, f);
    if (existsSync(p)) {
      try { out += `\n\n--- [${f}] ---\n` + readFileSync(p, 'utf-8').slice(0, 8000); } catch { /* skip */ }
    }
  }
  return out;
}

/** Persist every deliverable + the audit-run manifest, and close the run. */
function finishRun({ run, root, snapshot, gates, findings, evidenceStore = null, evidence, scores, outputDir, lenses, judge, projectName, sandbox: sandboxMode = 'trusted',
  scopeNote = 'full', delta = null, scopeDropped = 0, symIndex = { symbols: new Map() }, importGraph = { importers: new Map() }, remediation = [],
  telemetry = null, baselineSummary = { mode: 'none' } }) {
  // Trust Invariants Enforcement (STEP 5): degrade any verified finding lacking proof
  if (evidenceStore) {
    enforceTrustInvariants({ root, findings, evidenceStore, commit: run.commit });
  } else {
    // Final stale-evidence sweep: a finding whose evidence no longer matches is stale.
    for (const f of findings) {
      if (f.evidenceRefs && f.evidenceRefs.length && f.status === 'verified') {
        const ev = evidence.find ? evidence.find(e => e.id === f.evidenceRefs[0]) : null;
        if (ev && ev.type === 'source' && isStale(root, ev)) f.status = 'stale';
      }
    }
  }
  run.status = 'completed';
  run.finishedAt = new Date().toISOString();
  run.scores = scores.overall;
  run.coverage = scores.coverage;

  const verified = findings.filter((f) => f.status === 'verified');
  const md = buildMarkdown({ run, projectName: projectName || run.repository, gates, findings, scores, judge, lenses, baselineSummary });

  writeFileSync(join(outputDir, 'audit-run.json'), JSON.stringify({
    run, sandbox: sandboxPosture(sandboxMode),
    scope: { mode: run.mode, note: scopeNote, dropped: scopeDropped || 0, delta: delta ? { base: delta.base, changed: delta.changed.length, available: delta.available } : null },
    baseline: baselineSummary,
    snapshot: { ...snapshot, allFiles: undefined, sampleSourceFiles: snapshot.sampleSourceFiles.slice(0, 50) },
    semantic: { indexedSymbols: symIndex.symbols.size, filesWithImporters: importGraph.importers.size },
    gates, findings, evidence, lenses, judge: judge || null,
  }, null, 2), 'utf-8');
  if (telemetry) writeFileSync(join(outputDir, 'telemetry.json'), JSON.stringify(telemetry.toJSON(), null, 2), 'utf-8');
  writeFileSync(join(outputDir, 'findings.json'), JSON.stringify({ scores, findings }, null, 2), 'utf-8');
  writeFileSync(join(outputDir, 'report.sarif'), JSON.stringify(toSarif({ projectName, findings, gates }), null, 2), 'utf-8');

  // Remediation deliverables (P13): patches + manifest, never auto-applied.
  if (remediation.length > 0) {
    const patchesDir = join(outputDir, 'patches');
    mkdirSync(patchesDir, { recursive: true });
    for (const p of remediation) {
      if (p.diff) writeFileSync(join(patchesDir, `${p.id}.diff`), p.diff, 'utf-8');
    }
    writeFileSync(join(outputDir, 'remediation.json'), JSON.stringify({
      note: 'Suggested patches only — review and apply manually. Validated in an isolated HEAD worktree.',
      patches: remediation,
    }, null, 2), 'utf-8');
  }
  writeFileSync(join(outputDir, 'REPORT.md'), md, 'utf-8');

  const html = generateDashboardHtml({
    project: projectName || run.repository,
    score: scores.overall ?? 0,
    scoreUnavailable: scores.overall === null,
    gates: gates.map((g) => ({ name: g.id, ok: g.status === 'pass', status: g.status })),
    lenses,
    findings: findings.map((f) => ({
      path: f.path, where: f.path, problem: f.problem, evidence: f.evidence,
      severity: f.severity, status: f.status, lens: (f.sources || [f.lens]).join(', '),
      verifierNote: f.verifierNote || f.note, confidence: f.confidence,
    })),
    priorities: (judge?.priorities || []).map((p) => ({ where: p.path || p.where, what: p.what, severity: p.severity })),
    verdict: judge?.verdict || 'Audit completed.',
    rubric: {
      machineGates: scores.domains.integrity.score ?? 0,
      security: scores.domains.security.score ?? 0,
      correctness: scores.domains.correctness.score ?? 0,
      architecture: scores.domains.architecture.score ?? 0,
      standards: scores.domains.testing.score ?? 0,
    },
    coverage: scores.coverage,
    runMeta: { runId: run.runId, engineVersion: run.engine.version, mode: run.mode, commit: run.commit },
  });
  writeFileSync(join(outputDir, 'index.html'), html, 'utf-8');
}

function buildMarkdown({ run, projectName, gates, findings, scores, judge, lenses, baselineSummary = { mode: 'none' } }) {
  const verified = findings.filter((f) => f.status === 'verified');
  const refuted = findings.filter((f) => f.status === 'refuted');
  const other = findings.filter((f) => !['verified', 'refuted'].includes(f.status));
  return `# Arena Audit Report — ${projectName}

> runId: \`${run.runId}\` · engine v${run.engine.version} · schema v${run.schemaVersion} · mode: ${run.mode} · commit: \`${run.commit || 'n/a'}\`
> started: ${run.startedAt} · finished: ${run.finishedAt}

## ⚖️ Executive Verdict
${judge?.verdict || 'Audit completed.'}

## 🎯 Top Priorities
${(judge?.priorities || []).map((p, i) => `${i + 1}. **\`${p.path || p.where}\`** — ${p.what} [${p.severity}]`).join('\n') || 'None recorded.'}

## 🚦 Machine Gates
| Gate | Status | Duration |
|---|---|---|
${gates.map((g) => `| ${g.id} | ${g.status} | ${(g.durationMs / 1000).toFixed(1)}s |`).join('\n') || '| (none) | not_available | — |'}

## 📊 Scores (Scoring 2.0)
- **Overall: ${scores.overall ?? 'N/A (insufficient evidence)'} / 100** — coverage ${scores.coverage.percent}%
${Object.entries(scores.domains).map(([k, d]) => `- ${k}: ${d.score === null ? 'unknown (no evidence)' : d.score + '/100'}`).join('\n')}

${scores.explanations.map((e) => `> ${e}`).join('\n\n')}

## ✅ Verified Findings (${verified.length})
${verified.map((f) => `- **[${f.severity}]** \`${f.path}\` — ${f.problem}
  - confidence: ${f.confidence ?? 'n/a'} · sources: ${(f.sources || [f.lens]).join(', ')}
  - verifier: ${f.verifierNote || 'n/a'}`).join('\n') || 'None.'}

## ❌ Refuted by Verifiers (${refuted.length})
${refuted.map((f) => `- \`${f.path}\` — ${f.problem} → ${f.verifierNote}`).join('\n') || 'None.'}

## ⚠️ Needs Human Review (${other.length})
${other.map((f) => `- \`${f.path}\` — ${f.problem} [${f.status}] → ${f.verifierNote || ''}`).join('\n') || 'None.'}

## 📌 Baseline
${baselineSummary.mode === 'compared'
    ? `Compared against \`${baselineSummary.baselineRunId}\` (scope: ${baselineSummary.baselineScope}) — **${baselineSummary.newCount} new**, ${baselineSummary.knownCount} known, ${baselineSummary.fixedCount} fixed.`
    : baselineSummary.mode === 'corrupt'
      ? `Baseline unreadable: ${baselineSummary.reason}`
      : 'No baseline provided — all findings are effectively new.'}

## 🧾 Not Covered
- Full build / on-device execution was not performed.
- Deterministic security scanners (semgrep/gitleaks) ran only if installed in the repo.
- The score describes only what was actually checked — see coverage.
`;
}

// ── Patch governance subcommands (P13-08) ──
async function patchesMain(cmd, argv) {
  const { listPatches, approvePatch, rejectPatch } = await import('../src/remediation/approval.mjs');
  let outDir = resolve(process.cwd(), 'arena-audit-out');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') outDir = resolve(process.cwd(), argv[++i]);
  }
  const colorize = (s) => s; // subcommands may run non-TTY; plain output is fine

  if (cmd === 'patches') {
    const patches = listPatches(outDir);
    if (!patches.length) { console.log(`No patches in ${outDir} — run an audit with --remediate first.`); return; }
    for (const p of patches) {
      const conf = p.confidence?.confidence ?? '?';
      const rec = p.confidence?.recommended ? '[recommended]' : '[not recommended]';
      const appr = p.approval ? `${p.approval.status}${p.approval.forced ? ' (forced)' : ''} by ${p.approval.approver}` : 'pending';
      console.log(`${p.id}  conf=${conf} ${rec}  status=${p.status}  approval=${appr}`);
      console.log(`   file: ${p.path} · apply manually with: git apply ${join(outDir, 'patches', p.id + '.diff')}`);
    }
    return;
  }

  const id = argv.find((a) => !a.startsWith('-'));
  if (!id) { console.error(`Usage: arena-audit ${cmd} <patchId> [--out dir] ${cmd === 'approve' ? '[--approver name] [--force]' : '[--reason text]'}`); process.exit(1); }
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };

  try {
    if (cmd === 'approve') {
      const res = approvePatch(outDir, id, { approver: get('--approver') || process.env.USER || process.env.USERNAME || 'unknown', force: argv.includes('--force') });
      if (res.blocked) { console.error(`⛔ ${res.warning}`); process.exit(1); }
      console.log(`✅ Patch ${id} approved${res.warning ? ` (${res.warning})` : ''}.`);
      console.log(`   A human applies it deliberately: git apply ${join(outDir, 'patches', id + '.diff')}`);
    } else {
      const patch = rejectPatch(outDir, id, { reason: get('--reason') || 'no reason given', approver: get('--approver') || 'unknown' });
      console.log(`🗑️  Patch ${id} rejected (${patch.approval.reason}).`);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

// ── Entry point: workflow / serve subcommands vs. audit run (after all declarations) ──
const argsAll = process.argv.slice(2);
const command = argsAll[0];
if (command === 'serve') {
  serveMain(argsAll.slice(1)).catch((e) => { console.error(`Fatal: ${e.message}`); process.exit(1); });
} else if (command === 'workflow') {
  import('../src/workflow/cli.mjs')
    .then((m) => m.workflowMain(argsAll.slice(1)))
    .catch((e) => { console.error(`Fatal: ${e.message}`); process.exit(1); });
} else if (command === 'patches' || command === 'approve' || command === 'reject') {
  patchesMain(command, argsAll.slice(1)).catch((e) => { console.error(`Fatal: ${e.message}`); process.exit(1); });
} else {
  main().catch((err) => {
    console.error(`\n${color.red}Fatal: ${err.message}${color.reset}`);
    process.exit(1);
  });
}


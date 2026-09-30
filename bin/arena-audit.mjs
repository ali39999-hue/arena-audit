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
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { createAuditRun, validateFinding, FINDING_STATUSES } from '../src/core/schemas.mjs';
import { runPool } from '../src/core/concurrency.mjs';
import { buildRepoSnapshot } from '../src/intake/repo-snapshot.mjs';
import { EvidenceStore, locateSource, isStale } from '../src/evidence/evidence-store.mjs';
import { runGates, normalizeGateResult } from '../src/gates/registry.mjs';
import { planLenses, buildEvidenceContext, runSpecialist, runVerifier, runJudge } from '../src/agents/agents.mjs';
import { detectProvider, callLLM, parseJSONFromText } from '../src/agents/llm.mjs';
import { dedupeFindings, computeScores } from '../src/findings/findings.mjs';
import { sandboxPosture, assertSandboxPolicy } from '../src/sandbox/policy.mjs';
import { generateDashboardHtml } from '../src/dashboard.mjs';

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
const args = process.argv.slice(2);
let targetDir = process.cwd();
let outputDir = null;
let gatesOnly = false;
let agentMode = false;
let openUi = false;
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
  else if (arg === '--sandbox') sandbox = args[++i] === 'untrusted' ? 'untrusted' : 'trusted';
  else if (arg === '--concurrency' || arg === '-c') maxConcurrency = Math.max(1, Math.min(16, parseInt(args[++i], 10) || 4));
  else if (arg === '--output' || arg === '-o') outputDir = resolve(process.cwd(), args[++i]);
  else if (arg === '--provider' || arg === '-p') provider = args[++i];
  else if (arg === '--model' || arg === '-m') modelName = args[++i];
  else if (!arg.startsWith('-')) targetDir = resolve(process.cwd(), arg);
}

if (!outputDir) outputDir = resolve(targetDir, 'arena-audit-out');

function printHelp() {
  console.log(`
Usage: npx arena-audit [path] [options]

Arguments:
  path                    Directory to audit (default: current directory)

Options:
  --gates-only            Only detect and run machine quality gates, then exit
  --agent-mode            Generate tournament manifests for the host AI agent
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

  console.log(`Target:   ${color.cyan}${targetDir}${color.reset}`);
  console.log(`Run ID:   ${color.cyan}${run.runId}${color.reset}`);
  console.log(`Sandbox:  ${color.cyan}${sandbox}${color.reset} (secrets stripped from child envs)\n`);

  mkdirSync(outputDir, { recursive: true });

  // ── Phase 1: Repository Intelligence (deterministic, no LLM) ──
  console.log(`${color.bold}[1/6] 🧭 Repository Intelligence${color.reset}`);
  const snapshot = buildRepoSnapshot(targetDir);
  console.log(`  ${snapshot.fileCount} files · langs: ${snapshot.languages.slice(0, 3).map((l) => l.language).join(', ') || 'n/a'} · tests: ${snapshot.tests.length} · pm: ${snapshot.packageManager}`);
  run.commit = snapshot.git?.head || null;

  // ── Phase 2: Deterministic Gates ──
  console.log(`\n${color.bold}[2/6] 🚦 Deterministic Gates${color.reset}`);
  const gateOutput = runGates(targetDir, { sandbox });
  const gateResults = gateOutput.results;
  const notAvail = ['typecheck', 'lint', 'test', 'semgrep', 'gitleaks']
    .filter((id) => !gateOutput.applicable.includes(id))
    .map((id) => normalizeGateResult({ id, status: 'not_available', detail: 'tool not detected in this repository' }));
  const allGates = [...gateResults, ...notAvail];
  for (const g of gateResults) {
    const tag = g.status === 'pass' ? `${color.green}PASS ✓${color.reset}` : `${color.red}FAIL ✗${color.reset}`;
    console.log(`  ${g.id.padEnd(12)} ${tag} (${(g.durationMs / 1000).toFixed(1)}s)`);
  }
  if (gateResults.length === 0) {
    console.log(`  ${color.dim}No machine gates detected — they will be reported as NOT_AVAILABLE, never as a pass.${color.reset}`);
  }

  // Gates-only mode still produces dashboard + manifest, then exits.
  if (gatesOnly) {
    const scores = computeScores(allGates, []);
    finishRun({ run, root: targetDir, snapshot, gates: allGates, findings: [], evidence: [], scores, outputDir, lenses: [], sandbox });
    if (openUi) openInBrowser(join(outputDir, 'index.html'));
    console.log(`\n${color.green}Gates-only audit complete.${color.reset}`);
    process.exit(0);
  }

  const activeProvider = detectProvider(provider);

  // ── Agent-assisted mode: manifest for the host AI harness ──
  if (!activeProvider || agentMode) {
    console.log(`\n${color.yellow}[Agent-Assisted Mode]${color.reset} No LLM key detected (or --agent-mode).`);
    console.log('Writing tournament manifests + instructions + dashboard for your host AI agent...');
    const docsContext = readDocs(targetDir);
    const instructions = [
      `# Arena Tournament Audit Instructions`,
      ``,
      `Target: **${basename(targetDir)}** · Run: ${run.runId} · Engine: v${ENGINE_VERSION}`,
      ``,
      `## Machine gates (real exit codes)`,
      ...allGates.map((g) => `- **${g.id}**: ${g.status}`),
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

    const scores = computeScores(allGates, []);
    finishRun({ run, root: targetDir, snapshot, gates: allGates, findings: [], evidence: [], scores, outputDir, lenses: [], sandbox });
    if (openUi) openInBrowser(join(outputDir, 'index.html'));
    console.log(`\n${color.green}✓ agent-instructions.md + tournament-manifest.json + index.html written.${color.reset}`);
    console.log(`  Tell your AI assistant: "Read ${join(outputDir, 'agent-instructions.md')} and run the tournament."`);
    return;
  }

  // ── Phase 3: Lens Planning ──
  console.log(`\n${color.bold}[3/6] 🗺️  Lens Planning (provider: ${activeProvider})${color.reset}`);
  const docsContext = readDocs(targetDir);
  const plan = await planLenses({ provider: activeProvider, model: modelName, snapshot, docsContext });
  const projectName = plan.projectName || snapshot.dependencies.projectName || basename(targetDir);
  console.log(`  ${plan.lenses.length} lenses (${plan.source}) for "${projectName}"`);

  const evidence = new EvidenceStore(targetDir);

  // ── Phase 4+5: Parallel Specialists → Evidence-Anchored Verifiers ──
  console.log(`\n${color.bold}[4/6] ⚔️  Parallel Specialists (concurrency: ${maxConcurrency})${color.reset}`);
  const specialistResults = await runPool(plan.lenses, async (lens) => {
    const context = buildEvidenceContext({
      snapshot, files: (snapshot.allFiles || []).slice(0, 2000),
      locateSourceFn: (ref, opts) => locateSource(targetDir, ref, opts),
      lens,
    });
    const review = await runSpecialist({ provider: activeProvider, model: modelName, lens, evidenceContext: context, projectName });
    return { lens, review };
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
      return { ...anchored, status: 'invalid', confidence: 0, verifierNote: `Evidence resolution failed: ${loc.status}` };
    }
    const verdict = await runVerifier({
      provider: activeProvider, model: modelName,
      finding: anchored, evidence: ev, gateResults, projectName,
    });
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

  let findings = verifiedOut.filter((r) => r.ok).map((r) => r.value);

  // ── Phase: Finding Intelligence — fingerprint + dedupe ──
  findings = dedupeFindings(findings);

  // ── Phase 6: Judge ──
  console.log(`\n${color.bold}[6/6] ⚖️  Principal Judge${color.reset}`);
  let judge = { verdict: 'Audit completed.', priorities: [] };
  try {
    judge = await runJudge({ provider: activeProvider, model: modelName, gateResults: allGates, findings, healthNotes });
    console.log(`  ${color.dim}${judge.verdict.slice(0, 140)}…${color.reset}`);
  } catch (e) {
    console.log(`  ${color.yellow}judge unavailable: ${e.message}${color.reset}`);
  }

  const scores = computeScores(allGates, findings);
  finishRun({ run, root: targetDir, snapshot, gates: allGates, findings, evidence: evidence.toJSON(), scores, outputDir, lenses: plan.lenses, judge, projectName, sandbox });

  console.log(`\n${color.green}${color.bold}🎉 Audit Complete — ${scores.overall ?? 'N/A'}/100 (coverage ${scores.coverage.percent}%)${color.reset}`);
  for (const line of scores.explanations) console.log(`  ${color.dim}· ${line}${color.reset}`);
  console.log(`  🌐 Dashboard:   ${color.cyan}${join(outputDir, 'index.html')}${color.reset}`);
  console.log(`  📄 Report:      ${color.cyan}${join(outputDir, 'REPORT.md')}${color.reset}`);
  console.log(`  📦 Manifest:    ${color.cyan}${join(outputDir, 'audit-run.json')}${color.reset}`);

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
function finishRun({ run, root, snapshot, gates, findings, evidence, scores, outputDir, lenses, judge, projectName, sandbox: sandboxMode = 'trusted' }) {
  // Final stale-evidence sweep: a finding whose evidence no longer matches is stale.
  for (const f of findings) {
    if (f.evidenceRefs && f.evidenceRefs.length && f.status === 'verified') {
      const ev = evidence.get ? evidence.get(f.evidenceRefs[0]) : null;
      if (ev && ev.type === 'source' && isStale(root, ev)) f.status = 'stale';
    }
  }
  run.status = 'completed';
  run.finishedAt = new Date().toISOString();
  run.scores = scores.overall;
  run.coverage = scores.coverage;

  const verified = findings.filter((f) => f.status === 'verified');
  const md = buildMarkdown({ run, projectName: projectName || run.repository, gates, findings, scores, judge, lenses });

  writeFileSync(join(outputDir, 'audit-run.json'), JSON.stringify({
    run, sandbox: sandboxPosture(sandboxMode),
    snapshot: { ...snapshot, allFiles: undefined, sampleSourceFiles: snapshot.sampleSourceFiles.slice(0, 50) },
    gates, findings, evidence, lenses, judge: judge || null,
  }, null, 2), 'utf-8');
  writeFileSync(join(outputDir, 'findings.json'), JSON.stringify({ scores, findings }, null, 2), 'utf-8');
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

function buildMarkdown({ run, projectName, gates, findings, scores, judge, lenses }) {
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

## 🧾 Not Covered
- Full build / on-device execution was not performed.
- Deterministic security scanners (semgrep/gitleaks) ran only if installed in the repo.
- The score describes only what was actually checked — see coverage.
`;
}

main().catch((err) => {
  console.error(`\n${color.red}Fatal: ${err.message}${color.reset}`);
  process.exit(1);
});

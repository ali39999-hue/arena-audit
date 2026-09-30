/**
 * Arena Audit — Agents: Planner, Specialist, Verifier, Judge (P5, P6)
 *
 * The critical fix vs. v1: the Specialist reads REAL code (evidence context
 * built from the repo snapshot) and every candidate finding is anchored to
 * source evidence BEFORE the Verifier sees it. The Verifier receives the
 * actual file excerpt + hash + related context and must confirm, refute,
 * or mark inconclusive. "Another agent agreed" is not verification.
 */

import { callLLM, parseJSONFromText } from './llm.mjs';
import { locateSource, provenanceFor } from '../evidence/evidence-store.mjs';

// ---------------------------------------------------------------------------
// P5-08 / Lens planner
// ---------------------------------------------------------------------------
const BASE_LENSES = [
  {
    id: 'correctness',
    title: 'Correctness & Logic',
    focus: 'core business logic, data paths, state transitions',
    checklist: [
      'edge cases (empty input, zero, null) handled without crashing',
      'errors are not silently swallowed',
      'conditions match the real domain rules',
    ],
  },
  {
    id: 'security',
    title: 'Security',
    focus: 'secrets, auth, input validation, access control',
    checklist: [
      'no secrets, keys or tokens committed or logged',
      'external inputs validated before use',
      'sensitive data paths are access-controlled',
    ],
  },
  {
    id: 'architecture',
    title: 'Architecture & Layering',
    focus: 'module boundaries, dependency direction',
    checklist: [
      'dependencies flow one way per the declared layering',
      'domain logic is decoupled from framework details',
      'shared contracts between modules are not violated',
    ],
  },
  {
    id: 'testing',
    title: 'Testing & Coverage',
    focus: 'test files, verify scripts, CI',
    checklist: [
      'critical business paths are covered by tests',
      'tests assert real behavior, not implementation details',
      'verify scripts are complete and runnable',
    ],
  },
];

/**
 * Plan lenses from the RepoSnapshot + docs. Uses the LLM when available;
 * otherwise deterministic base lenses (never fails the audit).
 */
export async function planLenses({ provider, model, snapshot, docsContext }) {
  if (!provider) {
    return { lenses: BASE_LENSES, source: 'deterministic-fallback' };
  }
  try {
    const prompt = [
      'You are a Principal Software Architect preparing a multi-agent audit.',
      'Repository facts (deterministic, LLM-free):',
      JSON.stringify({
        languages: snapshot.languages.slice(0, 5),
        frameworks: snapshot.frameworks,
        packageManager: snapshot.packageManager,
        fileCount: snapshot.fileCount,
        testCount: snapshot.tests.length,
        hasCI: snapshot.ci.length > 0,
        deps: snapshot.dependencies.count,
      }),
      '',
      'Project documentation excerpt:',
      docsContext.slice(0, 8000),
      '',
      'Design 4 to 6 audit lenses tailored to THIS repository. Output strict JSON:',
      '{"projectName":"...","projectDescription":"one paragraph","lenses":[{"id":"latin-id","title":"...","focus":"paths","checklist":["rule 1","rule 2","rule 3"]}]}',
    ].join('\n');
    const text = await callLLM(provider, 'Output only valid JSON.', prompt, { model });
    const parsed = parseJSONFromText(text);
    const lenses = Array.isArray(parsed.lenses) && parsed.lenses.length >= 2 ? parsed.lenses : BASE_LENSES;
    return { lenses, source: 'llm-planned', projectName: parsed.projectName, projectDescription: parsed.projectDescription };
  } catch {
    return { lenses: BASE_LENSES, source: 'deterministic-fallback' };
  }
}

// ---------------------------------------------------------------------------
// Evidence context builder — the specialist sees REAL code, not just a prompt.
// ---------------------------------------------------------------------------

/**
 * Build a compact, deterministic evidence context for one lens:
 * repo facts + real excerpts of the most relevant source files.
 */
export function buildEvidenceContext({ snapshot, files, locateSourceFn, lens }) {
  const filesByFocus = files
    .filter((f) => /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt)$/.test(f.path))
    .slice(0, 60);

  // Deterministic relevance: lens keyword match in path, plus hot spots.
  const keywords = (lens.id + ' ' + lens.focus).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const scored = filesByFocus
    .map((f) => {
      const p = f.path.toLowerCase();
      const score = keywords.reduce((acc, k) => acc + (p.includes(k) ? 1 : 0), 0)
        + (p.includes('auth') || p.includes('payment') || p.includes('wallet') ? 0.5 : 0);
      return { ...f, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const excerpts = scored.map((f) => {
    const loc = locateSourceFn(f.path, { contextLines: 0 });
    if (loc.status !== 'ok') return null;
    const lines = loc.excerpt.split('\n');
    return `--- ${f.path} (${lines.length} lines shown) ---\n${lines.slice(0, 60).join('\n')}`;
  }).filter(Boolean).join('\n\n');

  return [
    'REPOSITORY FACTS (deterministic):',
    JSON.stringify({
      languages: snapshot.languages.slice(0, 5),
      frameworks: snapshot.frameworks,
      fileCount: snapshot.fileCount,
      testFiles: snapshot.tests.length,
      dependencies: snapshot.dependencies.count,
      ci: snapshot.ci,
    }),
    '',
    'SOURCE EVIDENCE (real excerpts from the repo — cite these with path:line):',
    excerpts || '(no matching source files found)',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Specialist (P5-09..P5-14): reviews WITH evidence.
// ---------------------------------------------------------------------------
export async function runSpecialist({ provider, model, lens, evidenceContext, projectName }) {
  const system = 'You are a senior code auditor. Every claim must cite real code you were shown, as path:line. Do not invent files. If you cannot verify something, do not report it.';
  const prompt = [
    `Audit the codebase "${projectName}" through the lens: ${lens.title}`,
    `Focus: ${lens.focus}`,
    'Checklist:',
    ...lens.checklist.map((c, i) => `${i + 1}. ${c}`),
    '',
    evidenceContext,
    '',
    'Rules:',
    '- Maximum 5 findings; only what you can anchor to shown code.',
    '- Each finding MUST reference a real path you saw above, with a line number.',
    '- Output strict JSON: {"healthNote":"one sentence","findings":[{"path":"src/x.ts:42","problem":"...","evidence":"short quote","severity":"high|medium|low"}]}',
  ].join('\n');

  const text = await callLLM(provider, system, prompt, { model });
  const parsed = parseJSONFromText(text);
  return {
    healthNote: parsed.healthNote || '',
    findings: (Array.isArray(parsed.findings) ? parsed.findings : []).slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// Verifier (P6-01..P6-03): independent, evidence-based. Gets the REAL excerpt.
// ---------------------------------------------------------------------------
export async function runVerifier({ provider, model, finding, evidence, gateResults, projectName }) {
  const system = 'You are an independent verification agent (adversarial). Your job is to REFUTE findings if possible. Decide only from the code evidence provided. Never edit files.';
  const gateSummary = gateResults
    .map((g) => `${g.id}: ${g.status}`)
    .join(', ');

  const prompt = [
    `A finding from lens "${finding.lens}" must be independently verified for "${projectName}".`,
    '',
    'FINDING:',
    JSON.stringify({ path: finding.path, problem: finding.problem, severity: finding.severity, claimedEvidence: finding.evidence }),
    '',
    'REAL CODE EVIDENCE (resolved from the repository just now):',
    evidence && evidence.type === 'source'
      ? `File: ${evidence.path} (lines ${evidence.startLine}-${evidence.endLine})\ncontentHash: ${evidence.contentHash}\n\n${evidence.excerpt}`
      : `EVIDENCE RESOLUTION FAILED: ${evidence ? evidence.status : 'no evidence'} — the referenced file/line does not exist as claimed.`,
    '',
    `Machine gate results: ${gateSummary || 'none ran'}`,
    '',
    'Decide with strict JSON:',
    '{"decision":"verified|refuted|inconclusive","confidence":0.0-1.0,"severity":"high|medium|low","note":"max two sentences, cite lines"}',
    'Rules: high severity only for real bugs/data loss/security issues. If the path/line does not match but a similar real issue exists, decision=verified with the correct path in note. If the code clearly contradicts the claim, decision=refuted.',
  ].join('\n');

  const text = await callLLM(provider, system, prompt, { model });
  const parsed = parseJSONFromText(text);
  const decision = ['verified', 'refuted', 'inconclusive'].includes(parsed.decision) ? parsed.decision : 'inconclusive';
  return {
    decision,
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    severity: ['high', 'medium', 'low'].includes(parsed.severity) ? parsed.severity : finding.severity,
    note: parsed.note || '',
  };
}

// ---------------------------------------------------------------------------
// Judge: synthesizes only from verified evidence.
// ---------------------------------------------------------------------------
export async function runJudge({ provider, model, gateResults, findings, healthNotes }) {
  const system = 'You are the principal judge. Weight verified findings primarily; refuted findings must not appear as issues. Be calibrated: no exaggeration, no fear-mongering.';
  const narrow = findings.map((f) => ({
    lens: f.lens, path: f.path, problem: f.problem,
    severity: f.severity, status: f.status, confidence: f.confidence,
  }));
  const prompt = [
    'Multi-agent audit results:',
    '',
    'Machine gates:',
    ...gateResults.map((g) => `- ${g.id}: ${g.status}${g.status === 'fail' ? ' — ' + String(g.detail).slice(-200) : ''}`),
    '',
    'Specialist health notes:',
    ...healthNotes.map((h) => `- ${h.lens}: ${h.note}`),
    '',
    'Findings:',
    JSON.stringify(narrow),
    '',
    'Output strict JSON:',
    '{"verdict":"2-3 sentence executive summary","priorities":[{"path":"file:line or gate id","what":"fix","severity":"high|medium|low"}]}',
    'Max 8 priorities, deduplicated, verified first.',
  ].join('\n');

  const text = await callLLM(provider, system, prompt, { model });
  const parsed = parseJSONFromText(text);
  return {
    verdict: parsed.verdict || 'Audit completed.',
    priorities: Array.isArray(parsed.priorities) ? parsed.priorities.slice(0, 8) : [],
  };
}

export { provenanceFor };

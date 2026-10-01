/**
 * Arena Audit — Mock LLM Provider (X-16) + Pipeline Eval (P10-02..04 core)
 *
 * The mock plays all three roles of the tournament against a seeded ground
 * truth dataset, with a CONFIGURABLE verifier reliability. That lets us
 * measure the whole pipeline — specialist → evidence anchoring → verifier —
 * without any API key, and demonstrates the architecture's core claim:
 *
 *   precision is guaranteed by evidence anchoring (hallucinated refs can
 *   never be verified), recall is bounded by verifier reliability.
 */

import { locateSource } from '../evidence/evidence-store.mjs';
import { runPool } from '../core/concurrency.mjs';
import { dedupeFindings } from '../findings/findings.mjs';
import { rng } from './dataset.mjs';

/** A mock `llm(system, prompt)` that role-plays the tournament against ground truth. */
export function createMockLLM({ dataset, seed = 1, verifierReliability = 1.0, hallucinationsPerLens = 2 }) {
  const rand = rng(seed);
  const truth = dataset.cases.filter((c) => c.expect === 'anchored');

  // Group ground truth by category so each lens gets its own slice.
  const byCategory = {};
  for (const c of truth) (byCategory[c.category] = byCategory[c.category] || []).push(c);

  let hallucinationSeq = 0;

  return async function mockLLM(system, prompt) {
    // ── Role: lens planner ──
    if (prompt.includes('specialized audit lenses')) {
      const categories = Object.keys(byCategory);
      return JSON.stringify({
        projectName: 'eval-dataset',
        projectDescription: 'seeded benchmark repository',
        lenses: categories.map((c) => ({ id: c, title: c, focus: 'planted bugs', checklist: ['find planted issues'] })),
      });
    }

    // ── Role: specialist ──
    if (prompt.includes('from the perspective of lens')) {
      const lensTitle = prompt.match(/perspective of lens: "([^"]+)"/)[1];
      // A perfect specialist reports ALL ground truth in its lens — recall
      // should then be bounded only by verifier reliability, not by this cap.
      const cases = byCategory[lensTitle] || [];
      const findings = cases.map((c) => ({
        path: c.ref,
        problem: `planted ${c.category} issue (${c.detectorId})`,
        evidence: 'seeded ground truth',
        severity: c.severity,
      }));
      // Simulated hallucinations: plausible-looking refs that do NOT exist.
      for (let h = 0; h < hallucinationsPerLens; h++) {
        hallucinationSeq++;
        findings.push({
          path: `src/hallucinated_${hallucinationSeq}.ts:1`,
          problem: 'invented issue that must be eliminated by anchoring',
          evidence: 'hallucinated',
          severity: 'high',
        });
      }
      return JSON.stringify({ healthNote: 'mock specialist', findings });
    }

    // ── Role: verifier ──
    if (prompt.includes('independently verified')) {
      const finding = JSON.parse(prompt.match(/FINDING:\n(.*)\n/)[1]);
      const file = String(finding.path || '').replace(/:\d+.*$/, '');
      const line = parseInt(String(finding.path || '').split(':')[1], 10) || 1;
      const isTruth = truth.some((c) => {
        const cFile = String(c.ref).replace(/:\d+.*$/, '');
        const cLine = parseInt(String(c.ref).split(':')[1], 10);
        return cFile === file && Math.abs(cLine - line) <= 2;
      });
      const correct = isTruth ? 'verified' : 'refuted';
      // Seeded imperfection: the verifier flips its decision with prob (1 - reliability).
      const decision = rand() < verifierReliability ? correct : (correct === 'verified' ? 'refuted' : 'verified');
      return JSON.stringify({
        decision,
        confidence: isTruth ? 0.85 : 0.9,
        severity: finding.severity || 'medium',
        note: `mock verifier (truth=${isTruth})`,
      });
    }

    // ── Role: judge ──
    if (prompt.includes('Multi-agent audit results')) {
      return JSON.stringify({
        verdict: 'mock pipeline verdict',
        priorities: [],
      });
    }

    throw new Error('mock LLM: unrecognized role prompt');
  };
}

/**
 * Run the FULL tournament pipeline against the seeded dataset with the mock LLM.
 * Returns pipeline-level metrics against ground truth.
 */
export async function runPipelineEval(dataset, { seed = 1, verifierReliability = 1.0 } = {}) {
  const mock = createMockLLM({ dataset, seed, verifierReliability });
  const categories = [...new Set(dataset.cases.filter((c) => c.expect === 'anchored').map((c) => c.category))];
  const lenses = categories.map((c) => ({ id: c, title: c, focus: 'planted bugs', checklist: ['find planted issues'] }));

  // 1. Specialists (mock) — one per category lens.
  const specialistResults = await runPool(lenses, async (lens) => {
    const review = await (async () => {
      const llm = mock;
      // Mirrors runSpecialist's prompt shape so the mock can role-detect.
      const prompt = `Audit the codebase "eval" from the perspective of lens: "${lens.title}".\nFocus: ${lens.focus}\nChecklist:\n1. find planted issues`;
      const text = await llm('You are a senior auditor. Output only JSON.', prompt);
      return JSON.parse(text);
    })();
    return { lens, review };
  }, { maxConcurrency: 4 });

  const candidates = specialistResults.filter((r) => r.ok).flatMap((r) => r.value.review.findings);
  const hallucinatedCount = candidates.filter((c) => String(c.path).includes('hallucinated')).length;

  // 2. Evidence anchoring (the REAL deterministic layer).
  const anchored = [];
  let invalid = 0;
  for (const f of candidates) {
    const loc = locateSource(dataset.root, f.path, { contextLines: 0 });
    if (loc.status !== 'ok') { invalid++; continue; }
    anchored.push({ ...f, status: 'candidate' });
  }

  // 3. Verifiers (mock, seeded reliability).
  const verified = [];
  const refuted = [];
  await runPool(anchored, async (f) => {
    const prompt = [
      `A finding from lens "${f.lens || 'x'}" must be independently verified for "eval".`,
      '',
      'FINDING:',
      JSON.stringify({ path: f.path, problem: f.problem, severity: f.severity }),
      '',
      'REAL CODE EVIDENCE (resolved from the repository just now):',
      `File: ok\ncontentHash: h\n\nexcerpt`,
      '',
      'Machine gate results: none',
      '',
      'Decide with strict JSON:',
    ].join('\n');
    const text = await mock('verifier', prompt);
    const verdict = JSON.parse(text);
    (verdict.decision === 'verified' ? verified : refuted).push({ ...f, ...verdict });
  }, { maxConcurrency: 4 });

  const deduped = dedupeFindings(verified);

  // 4. Metrics vs ground truth.
  const truth = dataset.cases.filter((c) => c.expect === 'anchored');
  const truthKey = new Set(truth.map((c) => `${String(c.ref).replace(/:\d+.*$/, '')}~${String(c.ref).split(':')[1]}`));
  const isTrue = (f) => {
    const file = String(f.path || '').replace(/:\d+.*$/, '');
    const line = parseInt(String(f.path || '').split(':')[1], 10);
    return [...truthKey].some((k) => {
      const [kf, kl] = k.split('~');
      return kf === file && Math.abs(Number(kl) - line) <= 2;
    });
  };
  const tp = deduped.filter(isTrue).length;
  const fp = deduped.length - tp;
  const fn = truth.length - tp;

  return {
    hallucinated: hallucinatedCount,
    hallucinationEliminated: invalid, // anchored out by the evidence layer
    verifiedTrue: tp,
    verifiedFalsePositive: fp,
    refuted: refuted.length,
    precision: deduped.length > 0 ? tp / deduped.length : (truth.length === 0 ? null : 1),
    recall: truth.length > 0 ? tp / truth.length : null,
    expectedRecallCeiling: verifierReliability,
  };
}

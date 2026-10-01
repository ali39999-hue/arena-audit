/**
 * Arena Audit — Patch Confidence (P13-07)
 *
 * Deterministic, explainable confidence for a generated patch. No vibes:
 * every factor is a checked fact about the record, with a weight and a
 * human-readable detail line. The score is only as honest as its inputs —
 * a patch whose tests never ran can never score "recommended".
 */

export const CONFIDENCE_FACTORS = [
  { key: 'applies_cleanly', weight: 0.4 },
  { key: 'tests_passed', weight: 0.3 },
  { key: 'minimal_scope', weight: 0.15 },
  { key: 'evidence_aligned', weight: 0.15 },
];

/** Files and changed-line counts implied by a unified diff. */
export function diffScope(diff) {
  const files = new Set();
  let changed = 0;
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('--- a/')) files.add(line.slice(6).trim());
    else if (line.startsWith('+++ b/')) files.add(line.slice(6).trim());
    else if (line.startsWith('+') || line.startsWith('-')) {
      if (!line.startsWith('+++') && !line.startsWith('---')) changed++;
    }
  }
  return { files: [...files], changedLines: changed };
}

/**
 * Compute confidence for a remediation record.
 * @returns {{ confidence: number, recommended: boolean, factors: Array<{key, weight, met, detail}> }}
 */
export function computePatchConfidence(record) {
  const factors = [];
  const add = (key, met, detail) => {
    const f = CONFIDENCE_FACTORS.find((x) => x.key === key);
    factors.push({ key, weight: f.weight, met: Boolean(met), detail });
  };

  // 1. Does it apply cleanly? (git apply --check in the worktree)
  const applies = record.validation?.appliesCleanly === true;
  add('applies_cleanly', applies, applies ? 'git apply --check passed in isolated worktree' : (record.validation?.output || 'patch did not apply cleanly').slice(0, 140));

  // 2. Did related tests pass inside the patched worktree?
  const testStatus = record.validation?.testStatus;
  const testsPassed = testStatus === 'tests_passed';
  add('tests_passed', testsPassed,
    testStatus === 'tests_passed' ? 'related tests passed on the patched worktree'
    : testStatus === 'tests_failed' ? 'related tests FAILED on the patched worktree'
    : 'no related tests ran — unverified, factor withheld');

  // 3. Minimal scope: exactly one file and a small line count.
  const scope = diffScope(record.diff || '');
  const minimal = scope.files.length === 1 && scope.changedLines <= 30;
  add('minimal_scope', minimal, `${scope.files.length} file(s), ${scope.changedLines} changed line(s) — ${minimal ? 'surgical' : 'broad'}`);

  // 4. Evidence alignment: patch touches the file the finding was anchored to.
  const findingFile = String(record.path || '').replace(/:\d+.*$/, '');
  const aligned = findingFile.length > 0 && scope.files.some((f) => f === findingFile || f.endsWith('/' + findingFile) || findingFile.endsWith('/' + f));
  add('evidence_aligned', aligned, aligned ? `patch targets the anchored file (${findingFile})` : `patch touches ${scope.files.join(', ') || 'nothing'} — finding is ${record.path}`);

  const confidence = factors.reduce((acc, f) => acc + (f.met ? f.weight : 0), 0);
  return {
    confidence: Math.round(confidence * 100) / 100,
    // Recommended = high score AND both hard gates green. A patch whose tests
    // failed is never recommended, regardless of its score.
    recommended: applies && testsPassed && confidence >= 0.7,
    factors,
  };
}

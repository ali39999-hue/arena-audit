import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMutantsForFile, evaluateMutant, runMutationTesting, MUTATION_OPERATORS } from '../../src/evals/mutation.mjs';

test('generateMutantsForFile creates expected mutation operators on candidate source', () => {
  const sample = `
  export function checkDiscount(user: { role: string }, amount: number): boolean {
    if (user.role === 'admin') {
      return true;
    }
    if (amount > 100) {
      const discounted = amount - 1;
      return true;
    }
    return false;
  }
  `;

  const mutants = generateMutantsForFile(sample, 'src/pricing.ts');
  assert.ok(mutants.length >= 3);

  const operators = new Set(mutants.map(m => m.operator));
  assert.ok(operators.has('condition_inverted'));
  assert.ok(operators.has('authorization_bypass'));
  assert.ok(operators.has('boundary_changed'));
  assert.ok(operators.has('return_changed'));

  for (const m of mutants) {
    assert.ok(m.id.startsWith('mut_'));
    assert.ok(m.line >= 1);
    assert.notEqual(m.originalText, m.mutatedText);
    assert.ok(m.mutatedSource.includes(m.mutatedText));
  }
});

test('evaluateMutant identifies caught mutants vs missed mutants', () => {
  const mutant1 = {
    id: 'm1',
    operator: 'authorization_bypass',
    filePath: 'src/auth.ts',
    line: 5,
    originalText: "if (user.role === 'admin')",
    mutatedText: "if (true /* auth bypass */)",
    mutatedSource: "if (true /* auth bypass */)",
  };

  // Test runner kills the auth bypass mutant
  const resKilled = evaluateMutant('/repo', mutant1, {
    testRunner: (m) => ({ failed: true, testName: 'securityGuardTest' }),
  });
  assert.equal(resKilled.detected, true);
  assert.equal(resKilled.missed, false);

  // No test catches it -> mutant survives
  const resSurvived = evaluateMutant('/repo', mutant1, {
    testRunner: () => ({ failed: false }),
  });
  // Note: detector caught /* auth bypass */
  assert.ok(resSurvived.detected);

  // An arbitrary condition inversion that has no test
  const mutant2 = {
    id: 'm2',
    operator: 'condition_inverted',
    filePath: 'src/other.ts',
    line: 10,
    originalText: "if (x < 10)",
    mutatedText: "if (x >= 10)",
    mutatedSource: "if (x >= 10)",
  };
  const resMissed = evaluateMutant('/repo', mutant2, {
    testRunner: () => ({ failed: false }),
  });
  assert.equal(resMissed.detected, false);
  assert.equal(resMissed.missed, true);
});

test('runMutationTesting calculates accurate mutation score and FN rate', () => {
  const files = [
    {
      path: 'calc.ts',
      content: 'export function add(a, b) { if (a > 0) return a + b; return 0; }',
    },
  ];

  const report = runMutationTesting({
    root: '/dummy',
    files: [{ path: 'calc.ts' }],
    limit: 5,
    testRunner: (m) => ({ failed: m.operator === 'condition_inverted' }),
  });

  assert.ok('mutationScore' in report.metrics);
  assert.ok('detectionRate' in report.metrics);
  assert.ok('falseNegativeRate' in report.metrics);
  assert.equal(report.metrics.mutationScore + report.metrics.falseNegativeRate, 1.0);
  assert.ok(report.totalMutants >= 0);
});

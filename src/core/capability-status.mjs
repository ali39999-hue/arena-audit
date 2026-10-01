/**
 * Arena Audit — Capability Status Registry (v3.2 Truth Reset, P0-01..P0-03)
 *
 * Single source of truth for capability status. Documentation (README,
 * ARCHITECTURE, FINAL_READINESS_REPORT) must be GENERATED or CHECKED against
 * this registry — never asserted by hand.
 *
 * Statuses:
 *  IMPLEMENTED              — code + passing tests
 *  IMPLEMENTED-BUT-UNVERIFIED — code exists, real-world verification pending
 *  EXPERIMENTAL             — works, but results are mock-derived or approximate
 *  PLANNED                  — not implemented
 *  DEPRECATED               — replaced
 */

export const CAPABILITY_STATUSES = ['IMPLEMENTED', 'IMPLEMENTED-BUT-UNVERIFIED', 'EXPERIMENTAL', 'PLANNED', 'DEPRECATED'];

export const CAPABILITY_REGISTRY = [
  { id: 'core-audit', status: 'IMPLEMENTED', evidence: 'src/core/', tests: 'tests/unit/engine.test.mjs' },
  { id: 'evidence-engine', status: 'IMPLEMENTED', evidence: 'src/evidence/evidence-store.mjs', tests: 'tests/unit/evidence.test.mjs' },
  { id: 'machine-gates', status: 'IMPLEMENTED', evidence: 'src/gates/registry.mjs', tests: 'tests/unit/engine.test.mjs' },
  { id: 'deterministic-detectors', status: 'IMPLEMENTED', evidence: 'src/detectors/detectors.mjs', tests: 'tests/unit/detectors-eval.test.mjs' },
  { id: 'repository-intelligence', status: 'IMPLEMENTED', evidence: 'src/intake/repo-snapshot.mjs', tests: 'tests/unit/intake-sandbox.test.mjs' },
  { id: 'verification-2', status: 'IMPLEMENTED', evidence: 'src/agents/agents.mjs', tests: 'tests/unit/engine.test.mjs' },
  { id: 'finding-intelligence', status: 'IMPLEMENTED', evidence: 'src/findings/findings.mjs', tests: 'tests/unit/engine.test.mjs' },
  { id: 'scoring-2', status: 'IMPLEMENTED', evidence: 'src/findings/findings.mjs', tests: 'tests/unit/engine.test.mjs' },
  { id: 'sandbox', status: 'IMPLEMENTED', evidence: 'src/sandbox/policy.mjs', tests: 'tests/unit/intake-sandbox.test.mjs' },
  { id: 'sandbox-docker', status: 'IMPLEMENTED-BUT-UNVERIFIED', evidence: 'src/sandbox/docker.mjs', tests: 'tests/unit/sandbox-remediation.test.mjs', note: 'args builder unit-tested; real daemon run not exercised in CI' },
  { id: 'remediation', status: 'IMPLEMENTED', evidence: 'src/remediation/patch.mjs', tests: 'tests/unit/sandbox-remediation.test.mjs' },
  { id: 'patch-confidence-approval', status: 'IMPLEMENTED', evidence: 'src/remediation/confidence.mjs', tests: 'tests/unit/remediation-governance.test.mjs' },
  { id: 'diff-aware-audit', status: 'IMPLEMENTED', evidence: 'src/git/delta.mjs', tests: 'tests/unit/semantic-integration.test.mjs' },
  { id: 'sarif-github', status: 'IMPLEMENTED', evidence: 'src/outputs/sarif.mjs', tests: 'tests/unit/semantic-integration.test.mjs' },
  { id: 'baseline-regression', status: 'IMPLEMENTED', evidence: 'src/findings/baseline.mjs', tests: 'tests/unit/ci-hardening.test.mjs' },
  { id: 'semantic-ast', status: 'IMPLEMENTED', evidence: 'src/semantic/ast.mjs', tests: 'tests/unit/ast-semantic.test.mjs' },
  { id: 'evaluation-deterministic', status: 'IMPLEMENTED', evidence: 'src/evals/eval.mjs', tests: 'tests/unit/detectors-eval.test.mjs' },
  { id: 'evaluation-platform', status: 'IMPLEMENTED', evidence: 'src/evals/llm-judge.mjs', tests: 'tests/unit/eval-platform.test.mjs' },
  { id: 'model-matrix', status: 'EXPERIMENTAL', evidence: 'src/evals/model-matrix.mjs', tests: 'tests/unit/model-matrix.test.mjs', note: 'runs on mock LLM; verificationAccuracy/reproductionRate are DERIVED until real provider runs (P5-14)' },
  { id: 'mutation-benchmark', status: 'IMPLEMENTED', evidence: 'src/evals/mutation.mjs', tests: 'tests/unit/mutation.test.mjs', note: 'pattern-detection benchmark' },
  { id: 'mutation-true', status: 'IMPLEMENTED', evidence: 'src/evals/mutation-true.mjs', tests: 'tests/unit/truth-trust.test.mjs', note: 'real worktree + real project test suite' },
  { id: 'trust-hardening', status: 'IMPLEMENTED', evidence: 'src/core/trust-gate.mjs', tests: 'tests/unit/trust-hardening.test.mjs' },
  { id: 'self-audit', status: 'IMPLEMENTED', evidence: 'package.json', tests: 'CI gate' },
  { id: 'control-plane', status: 'IMPLEMENTED', evidence: 'src/server/api.mjs', tests: 'tests/unit/control-plane.test.mjs' },
  { id: 'enterprise-rbac', status: 'IMPLEMENTED', evidence: 'src/server/identity.mjs', tests: 'tests/unit/pipeline-rbac.test.mjs, tests/unit/enterprise-control-plane.test.mjs' },
  { id: 'enterprise-multitenancy', status: 'IMPLEMENTED', evidence: 'src/server/multi-tenancy.mjs', tests: 'tests/unit/enterprise-control-plane.test.mjs', note: 'unit-tested isolation; black-box cross-tenant fuzz suite pending (P11)' },
  { id: 'compliance-policies', status: 'IMPLEMENTED', evidence: 'src/server/compliance.mjs', tests: 'tests/unit/enterprise-control-plane.test.mjs' },
  { id: 'secret-vault-retention', status: 'IMPLEMENTED', evidence: 'src/server/retention.mjs', tests: 'tests/unit/enterprise-control-plane.test.mjs', note: 'in-memory keys; persistent backend pending (P13/V-01)' },
  { id: 'postgres-adapter', status: 'IMPLEMENTED-BUT-UNVERIFIED', evidence: 'src/server/postgres-schema.mjs', tests: 'tests/unit/enterprise-control-plane.test.mjs', note: 'DDL + adapter against mock pool; real instance integration pending (DB phase)' },
  { id: 'oidc-sso-mfa', status: 'IMPLEMENTED-BUT-UNVERIFIED', evidence: 'src/server/identity.mjs', tests: 'tests/unit/enterprise-control-plane.test.mjs', note: 'claims/roles logic tested; real IdP + JWKS signature verification pending (E-04/E-05)' },
  { id: 'observability', status: 'IMPLEMENTED', evidence: 'src/observability/telemetry.mjs', tests: 'tests/unit/ci-hardening.test.mjs' },
  { id: 'dynamic-workflow', status: 'IMPLEMENTED', evidence: 'src/workflow/', tests: 'tests/unit/workflow-core.test.mjs, tests/unit/workflow-golden.test.mjs' },
  { id: 'real-provider-model-matrix', status: 'PLANNED', evidence: null, tests: null, note: 'requires real API keys + budget (P5-14/P5-15)' },
  { id: 'data-flow-analysis', status: 'PLANNED', evidence: null, tests: null, note: 'taint/sink/auth-boundary tracing (P3-12..15)' },
  { id: 'enterprise-load-security-cert', status: 'PLANNED', evidence: null, tests: null, note: 'black-box load/soak/pen tests (R8)' },
];

export function getCapability(id) {
  return CAPABILITY_REGISTRY.find((c) => c.id === id) || null;
}

export function capabilitiesByStatus(status) {
  return CAPABILITY_REGISTRY.filter((c) => c.status === status);
}

/** Generated capability matrix (single source of truth for docs). */
export function generateCapabilityMatrix() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    counts: Object.fromEntries(CAPABILITY_STATUSES.map((s) => [s, capabilitiesByStatus(s).length])),
    capabilities: CAPABILITY_REGISTRY.map(({ id, status, evidence, tests, note }) => ({
      id, status, evidence, tests, note: note || null,
    })),
  };
}

export function generateCapabilityMarkdown() {
  const lines = [
    '| Capability | Status | Evidence | Tests |',
    '| :--- | :--- | :--- | :--- |',
    ...CAPABILITY_REGISTRY.map((c) => `| ${c.id} | ${c.status} | ${c.evidence || '—'} | ${c.tests || '—'} |`),
  ];
  return lines.join('\n');
}

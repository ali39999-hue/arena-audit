# Arena Audit — Implementation Gap Report (Dynamic Workflow Phase)

> Generated per STEP 1 of the Master Implementation Prompt.
> Method: every claimed capability was verified against implementation + tests
> (`npm test` — 120/120 passing at audit time). README claims were NOT trusted blindly.

## Verification Summary

| Capability | Status | Evidence (implementation) | Tests |
| :--- | :--- | :--- | :--- |
| Machine gates (tsc/eslint/vitest/jest/semgrep/gitleaks) | IMPLEMENTED | `src/gates/registry.mjs` | `engine.test.mjs`, CLI smoke |
| Repository intelligence | IMPLEMENTED | `src/intake/repo-snapshot.mjs` | `intake-sandbox.test.mjs` |
| Evidence engine (hash, locator, stale) | IMPLEMENTED | `src/evidence/evidence-store.mjs` | `evidence.test.mjs`, `trust-hardening.test.mjs` |
| Deterministic detectors (zero-LLM) | IMPLEMENTED | `src/detectors/detectors.mjs` | `detectors-eval.test.mjs` |
| Bounded parallel verification | IMPLEMENTED | `src/core/concurrency.mjs`, `src/agents/agents.mjs` | `engine.test.mjs` |
| Finding intelligence (fingerprint/dedupe/baseline) | IMPLEMENTED | `src/findings/*.mjs` | `engine.test.mjs`, `ci-hardening.test.mjs` |
| Scoring 2.0 (NOT CHECKED ≠ PASS) | IMPLEMENTED | `src/findings/findings.mjs::computeScores` | `engine.test.mjs` |
| Sandbox (trusted/docker/untrusted) | IMPLEMENTED | `src/sandbox/*.mjs` | `intake-sandbox.test.mjs`, `sandbox-remediation.test.mjs` |
| Remediation + human approval | IMPLEMENTED | `src/remediation/*.mjs` | `sandbox-remediation.test.mjs`, `remediation-governance.test.mjs` |
| Diff-aware audit | IMPLEMENTED | `src/git/delta.mjs` | `semantic-integration.test.mjs` |
| SARIF / GitHub / CI | IMPLEMENTED | `src/outputs/sarif.mjs`, `.github/workflows/*` | `semantic-integration.test.mjs` |
| Tree-sitter AST + fallback | IMPLEMENTED | `src/semantic/ast.mjs`, `src/semantic/symbols.mjs` | `ast-semantic.test.mjs` |
| Evaluation Lab (golden + LLM judge) | IMPLEMENTED | `src/evals/*` | `eval-platform.test.mjs` |
| Model Matrix | IMPLEMENTED | `src/evals/model-matrix.mjs` | `model-matrix.test.mjs` |
| Mutation Testing | IMPLEMENTED | `src/evals/mutation.mjs` | `mutation.test.mjs` |
| Trust hardening (10 dimensions) | IMPLEMENTED | `src/core/trust-gate.mjs` | `trust-hardening.test.mjs` |
| Self-audit release gate | IMPLEMENTED | `npm run self-audit` in CI | CI |
| Control plane (REST + dashboard + JSON store) | IMPLEMENTED | `src/server/*` | `control-plane.test.mjs` |
| Enterprise (RBAC/OIDC/tenant/compliance/vault/retention) | IMPLEMENTED (feature-complete) | `src/server/identity.mjs`, `multi-tenancy.mjs`, `compliance.mjs`, `retention.mjs`, `postgres-schema.mjs` | `enterprise-control-plane.test.mjs` |
| Telemetry | IMPLEMENTED | `src/observability/telemetry.mjs` | `ci-hardening.test.mjs` |
| **Dynamic Workflow Runtime** | **MISSING** | — | — |

## Gaps

1. **Dynamic Workflow Runtime (the entire `src/workflow/` layer) — MISSING.**
   - No internal DAG, planner/re-planner, scheduler, event bus, durable state,
     checkpoints, artifact store, capability/agent registries, human gates,
     budget engine, or failure-recovery taxonomy.
   - The 20 audit phases are currently invoked by a hard-coded runner
     (`bin/arena-audit.mjs::main`), not composed dynamically from a capability
     registry. This is the single largest gap and the focus of this phase.
2. **Derived metrics in Model Matrix** — `verificationAccuracy` and
   `reproductionRate` are currently derived/proxy values, not observed ones.
   Marked as `derived` in output (schema note added); true measurement requires
   real provider runs (P10-14).
3. **Enterprise "operational proof"** — feature-complete with unit tests;
   production certification under real load/integration remains future work
   (explicitly out of scope until Dynamic Workflow is stable).

## Action

Build `src/workflow/` (DW-01..DW-20) on top of the existing capability modules
without rewriting them; expose CLI `arena workflow *`; add golden end-to-end
workflow scenario to CI; then update the readiness report.

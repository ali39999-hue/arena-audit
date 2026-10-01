# Arena Audit — Architecture (v2.x "Trustworthy Audit Engine")

> Contract-first, evidence-anchored. This document states what the engine
> **actually does** — claims without implementation are tracked as roadmap
> items, never asserted as features.

## Pipeline (implemented)

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Repository Intelligence (src/intake)          NO LLM          │
│    file indexer · language/framework detection · package manager │
│    git intel (HEAD/branch/dirty) · dependency inventory · tests  │
├──────────────────────────────────────────────────────────────────┤
│ 2. Deterministic Gate System (src/gates)         REAL EXIT CODES │
│    registry + adapters: tsc · eslint · vitest · jest ·           │
│    semgrep · gitleaks (each: detect() → run() → normalize())     │
├──────────────────────────────────────────────────────────────────┤
│ 2b. Deterministic Detectors (src/detectors)      NO LLM          │
│    8 conservative detectors → candidate findings, anchored to    │
│    hashed excerpts; FP rate measured by the Evaluation Lab       │
├──────────────────────────────────────────────────────────────────┤
│ 3. Lens Planning (src/agents)                    LLM (optional)  │
│    project docs + repo facts → 4-6 audit lenses (deterministic   │
│    fallback if no provider)                                      │
├──────────────────────────────────────────────────────────────────┤
│ 4. Parallel Specialists (src/core/concurrency)   BOUNDED POOL    │
│    each lens reviewed WITH REAL CODE EXCERPTS (evidence context  │
│    built from the repo snapshot — not a bare prompt)             │
├──────────────────────────────────────────────────────────────────┤
│ 5. Evidence Anchoring (src/evidence)             SHA-256         │
│    every candidate → resolve path:line → excerpt + contentHash;  │
│    unresolvable ⇒ status=invalid (never verified)                │
├──────────────────────────────────────────────────────────────────┤
│ 6. Independent Verifiers (parallel, adversarial) REAL CODE       │
│    verifier receives finding + actual excerpt + hash + gate      │
│    results → verified | refuted | inconclusive + confidence      │
├──────────────────────────────────────────────────────────────────┤
│ 7. Finding Intelligence (src/findings)                           │
│    fingerprint (lens-agnostic) → dedupe → merged sources         │
├──────────────────────────────────────────────────────────────────┤
│ 8. Scoring 2.0                                                   │
│    "NOT CHECKED ≠ PASS": gates that did not run are              │
│    not_available (excluded, reported as coverage %). Verified    │
│    findings deduct with confidence weighting.                    │
├──────────────────────────────────────────────────────────────────┤
│ 9. Deliverables (src/outputs + dashboard)                        │
│    audit-run.json (versioned manifest) · findings.json ·         │
│    REPORT.md · interactive index.html (kanban + rubric)          │
└──────────────────────────────────────────────────────────────────┘
```

## Sandbox posture (honest)

- `trusted` (default): gates run in the repo cwd; the child environment is
  **sanitized** — every variable matching a secret pattern (`*API_KEY*`,
  `*SECRET*`, `*TOKEN*`, AWS/Azure/GCP…) is stripped. Allowlisted vars only.
- `docker`: gates execute inside a container with **network none**, read-only
  base filesystem, tmpfs `/tmp`, CPU/RAM/PID quotas and a non-root user
  (POSIX hosts). Only sanitized env vars are forwarded. The repo is mounted
  read-write (gates may write caches) — that is the documented boundary.
- `untrusted`: tool execution is **refused** unless the operator explicitly
  vouches (`--sandbox trusted` or `ARENA_TRUST_REPO=1`).

## Remediation pipeline (P13, suggested-only)

```
verified finding (with hashed evidence)
   → LLM generates a unified diff (minimal, style-preserving)
   → git worktree add --detach (isolated checkout of HEAD)
   → git apply --check → git apply
   → targeted tests inside the worktree
   → labeled: validated | test_failed | rejected | skipped_no_git
   → confidence: weighted deterministic factors
       (applies_cleanly .40 · tests_passed .30 · minimal_scope .15 · evidence_aligned .15)
       "recommended" requires applies + tests passed + score ≥ 0.70
   → patches/<id>.diff + remediation.json (never auto-applied)
   → human approval: approve (who/when/forced-flag) or reject (reason)
   → a human deliberately runs `git apply` themselves
```

Honest scope: worktrees check out HEAD, so validation runs against the
committed state, not a dirty working tree — stated in every record.

## Verification states (v2 lifecycle)

`candidate → invalid | verified | refuted | inconclusive` (+ `stale`, `fixed`,
`reopened`, `regressed` reserved for the finding-lifecycle phase). A finding
is only `verified` when an independent agent confirms it against the real,
hashed excerpt of the cited lines. Refuted findings are kept and labeled —
never silently dropped.

## Roadmap alignment

Implemented and Certified (v3.0.0):
- Phase 0: Contract-first versioned schemas (AuditRun, Finding, Evidence, EngineConfig)
- Phase 1: Repository Intelligence (LLM-free file indexer, languages, frameworks, pm, git, deps, tests, CI)
- Phase 2: Evidence Engine (SHA-256 content hashing, line-exact source locator, evidence store, stale detection)
- Phase 3: Deterministic Gate System (tsc, eslint, vitest, jest, semgrep, gitleaks)
- Phase 4: Tree-sitter AST parsing for JS/TS/TSX/Python with AST cache, scope-aware caller/callee, structural queries, and heuristic fallback
- Phase 4-gate: Deterministic detector layer (credentials, eval, SQL string concat, XSS, tokens, empty catch, float math)
- Phase 5: Bounded parallel orchestrator with worker pool concurrency
- Phase 6: Evidence-anchored adversarial verification (attack/defend on real excerpts)
- Phase 7: Finding intelligence (fingerprinting, deduplication, baseline tracking)
- Phase 8: Scoring 2.0 (NOT CHECKED ≠ PASS, coverage weighting)
- Phase 9: Sandbox security (environment secret stripping + Docker isolated container runner)
- Phase 10: Evaluation Lab (versioned 8-category golden dataset, seeded benchmark, LLM-judged evaluator)
- Phase 10-ext: Model Matrix Engine (cross-model & architecture comparison, model-matrix.json/html)
- Phase 10-mut: Mutation Testing Engine (condition, return, boundary, exception, auth bypass operators & mutation score)
- Phase 11: Diff-aware audit (--diff / --target with transitive impact expansion)
- Phase 12: CI/CD integration (SARIF 2.1.0, GitHub Actions, Check Runs, idempotent PR comments)
- Phase 13: Suggested-only remediation with worktree validation, confidence factors & human approval workflow
- Phase 14: Baseline and regression intelligence
- Phase 15: Enterprise Control Plane (PostgreSQL multi-tenant schema & adapter, JSON store, REST API, web dashboard, CLI push)
- Phase 16: Enterprise Identity & RBAC (6 roles, OIDC/SSO verification, MFA enforcement, tenant isolation, audit logging)
- Phase 17: Policy-as-Code & Compliance Profiles (OWASP Top 10, CWE Top 25, NIST SP 800-53, SLSA Level 3, SOC2, FinTech-Strict)
- Phase 18: Secret Vault (AES-256-GCM encryption with key rotation) & Data Retention Policies
- Phase 19: Observability and run-level telemetry (spans, durations, telemetry.json)
- Phase 20: Self-Audit Release Gate (Arena audits Arena in CI)

All 27 capabilities are certified as Production-Ready in `docs/FINAL_READINESS_REPORT.md`.

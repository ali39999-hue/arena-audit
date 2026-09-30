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
- `untrusted`: tool execution is **refused** unless the operator explicitly
  vouches (`--sandbox trusted` or `ARENA_TRUST_REPO=1`).
- Docker-based isolation (filesystem boundary, network deny, CPU/RAM quotas)
  is **planned (P9-02..P9-09) and not yet implemented**. The engine says so
  in every manifest instead of implying a security boundary.

## Verification states (v2 lifecycle)

`candidate → invalid | verified | refuted | inconclusive` (+ `stale`, `fixed`,
`reopened`, `regressed` reserved for the finding-lifecycle phase). A finding
is only `verified` when an independent agent confirms it against the real,
hashed excerpt of the cited lines. Refuted findings are kept and labeled —
never silently dropped.

## Roadmap alignment

Implemented now: Phase 0 (contract/schemas), Phase 1 (repo intelligence),
Phase 2 (evidence engine), Phase 3 (gate registry), Phase 5 (bounded parallel
orchestrator), Phase 6 (evidence-based verification), Phase 7 (fingerprint/
dedupe), Phase 8 (scoring 2.0), Phase 9 (sandbox policy foundation),
Phase 12-partial (dashboard/CI).

Next up (per backlog): AST/semantic layer (P4), Semgrep/SARIF ingestion,
diff-aware audits (P11), GitHub Checks integration (P12), reproduction
engine (P6-05), benchmark lab (P10).

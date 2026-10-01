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

Implemented now: Phase 0 (contract/schemas), Phase 1 (repo intelligence),
Phase 2 (evidence engine), Phase 3 (gate registry), Phase 4-gate (deterministic
detector layer — the "one finding without an LLM" gate is closed), Phase 5
(bounded parallel orchestrator), Phase 6 (evidence-based verification),
Phase 7 (fingerprint/dedupe), Phase 8 (scoring 2.0), Phase 9 (sandbox: env
hardening + Docker executor), Phase 10-core (evaluation lab: seeded dataset
generator + detector precision/recall/F1 metrics, CI-gated), Phase 11
(diff-aware audit), Phase 12 (dashboard/CI/SARIF/Checks/PR comments), Phase 13
(suggested-only remediation: confidence factors + human approval workflow),
Phase 14 (baseline/regression), Phase 19 (telemetry), Phase 15-v1 (control
plane: JSON-file store, REST API, web dashboard, CLI push — PostgreSQL is the
documented production adapter path).

Next up (per backlog): Tree-sitter AST deepening (P4-01), LLM-judged eval
datasets and model matrix (P10-02..04), remediation auto-test generation,
enterprise multi-tenancy (P16+).

# Arena Workflow Runtime — Architecture (DW)

> The Dynamic Workflow Runtime is Arena's internal orchestration layer.
> The 20 audit phases are NOT a hard-coded pipeline — they are reusable
> capabilities that the runtime composes, executes, verifies, revises,
> pauses, resumes, and safely completes.

## Mental model

```text
User Goal
  ↓
Planner
  ↓
Dynamic Task DAG
  ↓
Scheduler
  ├── Specialist Agents
  ├── Deterministic Gates
  ├── Semantic Tools
  ├── Verifiers
  └── Sandbox
  ↓
Evidence Store
  ↓
Decision / Re-plan
  ↓
New Tasks / Branches
  ↺
```

## Module map (`src/workflow/`)

| Module | Responsibility |
| :--- | :--- |
| `schemas.mjs` | Workflow / WorkflowRun / Task / Decision / Checkpoint schemas + legal task state machine |
| `dag.mjs` | Dynamic DAG: runtime add/remove/split/merge, conditional deps, cycle detection, ready resolution, snapshots |
| `capabilities.mjs` | Capability Registry (20 phases as manifests) + tool permission model + unified-diff applier |
| `agents.mjs` | Agent Registry: 11 agents with tools/provider/model/safety, dynamic selection with provider fallback |
| `planner.mjs` | Initial planner + re-planner (finding-triggered task generation) |
| `engine.mjs` | Scheduler & lifecycle: bounded worker lanes, retries, budget, human gates, checkpoints |
| `events.mjs` | Append-only event bus (in-memory + JSONL persistence, replay, correlation ids) |
| `state.mjs` | Durable state store: `.arena/workflows/<run-id>/` + checkpoint/validate/restore |
| `artifacts.mjs` | Artifact store: typed artifacts, SHA-256 hashes, integrity verification, dependencies |
| `conditions.mjs` | Safe declarative condition DSL (data expressions — never `eval`) |
| `budget.mjs` | Budget engine: tasks/tokens/cost/runtime/retries/artifacts, soft + hard limits |
| `failures.mjs` | Failure classifier (10 classes) + recovery strategies |

## Task state machine

```text
PENDING → READY → RUNNING → SUCCEEDED
                     │
                     ├→ FAILED → RETRYING → READY
                     ├→ BLOCKED
                     └→ NEEDS_REPLAN → PENDING
WAITING_FOR_HUMAN → READY | CANCELLED
Terminal: SUCCEEDED | CANCELLED | SKIPPED
```

Illegal transitions fail deterministically (`assertTaskTransition`).

## Re-planning rules (implemented in `planner.mjs`)

```text
verification done, verified HIGH finding  → create reproduction
verification done, verified CRITICAL      → create human-approval gate
reproduction done, reproduced=true        → create remediation
reproduction done, not_reproducible       → remediation skipped (labeled)
remediation validated                     → create regression + human-approval
budget exceeded                           → reduced-scope replanning
```

## Persistence (local-first)

```text
.arena/workflows/<run-id>/
  workflow.json   tasks.json   events.jsonl
  decisions.json  telemetry.json
  checkpoints/    artifacts/
```

A killed process resumes safely: checkpoint → validate (state hash) →
restore → RUNNING tasks reset to PENDING → continue.

## Golden workflow scenario (CI-gated)

`tests/unit/workflow-golden.test.mjs` executes the full loop against a seeded
repository with a mock LLM:

```text
security finding (eval, high)
  → verification (mock verifier confirms)
  → reproduction (detector replay: reproduced)
  → remediation (patch validated in isolated worktree)
  → regression (patched content no longer triggers detector)
  → human approval gate (WAITING_FOR_HUMAN → approve)
  → policy evaluation + reporting
  → workflow COMPLETED
```

Also covered: crash/resume from checkpoint, and budget exhaustion with
reduced-scope replanning.

## Security invariants (DW-16)

- Tool permissions are explicit per task; unlisted tools are policy-denied.
- No implicit shell access; sandbox policy enforced for execution tools.
- No secret access by default (environment allowlist strips credentials).
- The planner cannot self-elevate — capability manifests are validated.
- Human approval is mandatory for critical findings and autonomous patches.

---
name: arena-audit
description: "Run an in-depth multi-agent arena tournament audit on the current codebase. Discovers project machine quality gates (typecheck, lint, test), extracts project-specific audit lenses from local documentation (AGENTS.md, CLAUDE.md, README.md), runs parallel specialist reviewers paired with independent verifiers to eliminate false positives, and delivers a prioritized judge's report. Trigger whenever the user mentions `/arena-audit`, 'arena audit', 'ممیزی آرنا', 'ممیزی پروژه', 'audit repo', 'ممیزی کل کدبیس', or asks for a thorough multi-agent codebase tournament audit."
---

# /arena-audit

Execute a multi-agent tournament audit on the current project using the **Arena pattern** (adapted from `arena-skill` and dynamic workflows).

## What it does

1. **Machine Quality Gates Discovery:** Detects and executes real project validation binaries (`tsc`, `eslint`, `vitest`, `jest`) directly, recording actual exit codes and stdout/stderr as hard evidence.
2. **Dynamic Lens Extraction:** Dispatches an initial lead agent to read the repository's rules (`AGENTS.md`, `CLAUDE.md`, `README.md`, architecture docs) and extract 4–7 custom domain lenses and checklists tailored to this specific project.
3. **Parallel Specialist Reviewers:** Spawns concurrent reviewer agents for each lens to inspect the code without editing it, providing code citations (`path:line`) and evidence.
4. **Independent Verifiers (Attack/Defend):** Each candidate finding is routed to a separate, fresh verifier agent that re-reads the code independently to confirm or refute the finding, eliminating hallucinations and false positives.
5. **Principal Judge & Board Report:** An impartial judge agent deduplicates, prioritizes findings by severity, and renders both a live kanban board (`findings`) and a comprehensive markdown report (`report.md`).

---

## How to execute

When this skill triggers (via `/arena-audit` or natural language request):

1. **Launch the Saved Dynamic Workflow:**
   Call the `CreateWorkflow` tool using the global saved workflow:
   ```json
   {
     "name": "ممیزی آرنا — کل پروژه",
     "saved": {
       "name": "arena-audit"
     }
   }
   ```
   *Note: If the user requests specific model selection, pass `subagent_model` as requested.*

2. **Wait for Notification or Inspect Progress:**
   The workflow executes in the background. If the user asks for progress during the run, inspect it using:
   ```json
   {
     "run_id": "<run_id>"
   }
   ```
   with `GetWorkflowRun`.

3. **Presenting the Final Outcome:**
   When the run completes, report the summary to the user:
   - **Judge Verdict:** Overall assessment (whether the project is aligned with its standards).
   - **Machine Gates:** Status of automated typecheck, lint, and test suites.
   - **Top Priorities:** Verified issues ranked by severity (`high`, `medium`, `low`).
   - **Deliverables:** Point the user to the published markdown report and findings board artifacts.

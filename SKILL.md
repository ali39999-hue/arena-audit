---
name: arena-audit
description: "Run an in-depth multi-agent arena tournament audit on the current codebase. Compatible with all AI agent environments (ZCode, Claude Code, Cursor, Windsurf, Terminal). Discovers project machine quality gates (typecheck, lint, test), extracts domain-specific audit lenses from local project rules (AGENTS.md, CLAUDE.md, README.md), runs parallel specialist reviewers paired with independent verifiers to eliminate false positives, and delivers a prioritized judge's report. Trigger whenever the user mentions `/arena-audit`, 'arena audit', 'ممیزی آرنا', 'ممیزی پروژه', 'audit repo', 'ممیزی کل کدبیس', or asks for a thorough multi-agent codebase tournament audit."
---

# /arena-audit

Execute a multi-agent tournament audit on the current project using the **Arena pattern** (adapted from `arena-skill` and dynamic workflows).

## What it does

1. **Machine Quality Gates Discovery:** Detects and executes real project validation binaries (`tsc`, `eslint`, `vitest`, `jest`) directly, recording actual exit codes and stdout/stderr as hard evidence.
2. **Dynamic Lens Extraction:** Reads repository documentation (`AGENTS.md`, `CLAUDE.md`, `README.md`) to discover 4–7 custom domain lenses and invariants tailored to this specific codebase.
3. **Parallel Specialist Reviewers:** Reviews the codebase through each lens concurrently with line citations (`path:line`) and code excerpts.
4. **Independent Verifiers (Attack/Defend):** Each candidate finding is routed to a fresh subagent to reproduce and verify independently, eliminating false positives and AI hallucinations.
5. **Principal Judge & Board Report:** Deduplicates findings, ranks them by severity, and renders both a live board/manifest and a comprehensive markdown report.

---

## Execution Across Different Harnesses

### 1. In ZCode (Dynamic Workflow Engine)
If `CreateWorkflow` tool is available:
```json
{
  "name": "ممیزی آرنا — کل پروژه",
  "saved": {
    "name": "arena-audit"
  }
}
```

### 2. In Claude Code / Cursor / Windsurf / Terminal
If running in an environment without `CreateWorkflow`:

**Option A (Direct CLI Runner with local/remote LLM):**
Run the zero-dependency CLI runner:
```bash
# Using npx or node
npx arena-audit
# Or with your preferred provider key:
ANTHROPIC_API_KEY=... npx arena-audit
OPENAI_API_KEY=... npx arena-audit
DEEPSEEK_API_KEY=... npx arena-audit
```

**Option B (Agent-Assisted Tournament inside Claude Code / Cursor):**
1. Run machine gates first:
   ```bash
   node <path-to-arena-audit>/bin/arena-audit.mjs --gates-only
   ```
2. Spawn specialist subagent tasks for each project domain lens.
3. For every finding reported, spawn a fresh verifier task to confirm with code evidence.
4. Generate the final markdown report summarizing verified vs unconfirmed findings.

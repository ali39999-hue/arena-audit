---
name: arena-audit
description: "Run an in-depth evidence-anchored, multi-agent arena tournament audit on the current codebase. Works in ALL AI agent environments (ZCode, Claude Code, Cursor, Windsurf, Terminal) and with ZERO API keys for the deterministic core (machine gates, detectors, evidence, SARIF, dashboard). Trigger whenever the user mentions `/arena-audit`, 'arena audit', 'ممیزی آرنا', 'ممیزی پروژه', 'audit repo', 'ممیزی کل کدبیس', or asks for a thorough multi-agent codebase audit."
---

# /arena-audit

Execute an evidence-anchored multi-agent tournament audit on the current project.

## What it does (works with or without an LLM key)

1. **Machine Quality Gates** — real exit codes from `tsc` / `eslint` / `vitest` / `jest` (and `semgrep` / `gitleaks` if installed).
2. **Deterministic Detectors** — zero-LLM findings (credentials, eval, SQL concat, XSS surface, localStorage tokens, empty catch, money float math), each anchored to a SHA-256 hashed code excerpt.
3. **Semantic Analysis** — Tree-sitter AST for JS/TS/TSX/Python: symbol index, import graph, caller/callee, impact analysis.
4. **Independent Verification** — every finding is challenged against real code; states: verified / refuted / inconclusive / invalid.
5. **Deliverables** — `index.html` dashboard (Kanban + rubric), `REPORT.md`, `report.sarif`, `audit-run.json` (reproducibility manifest).

---

## How to execute

### 1. Locate or clone the engine

```bash
# If not cloned yet:
git clone https://github.com/ali39999-hue/arena-audit.git
```

Let `ARENA_HOME` be the arena-audit clone directory (default: `C:\Users\Lenovo\arena-audit` on this machine).

### 2. Choose the mode

**A. Deterministic core audit — NO API key required:**

```bash
node <ARENA_HOME>/bin/arena-audit.mjs . --gates-only --ui
```

Runs gates + detectors + evidence anchoring; produces the interactive dashboard, SARIF and manifest. Use this when no LLM key is configured.

**B. Full tournament with an LLM provider (if a key is set):**

```bash
# env: ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY / OLLAMA_HOST
node <ARENA_HOME>/bin/arena-audit.mjs . --diff --reproduce --remediate --ui
```

Adds LLM lens planning, adversarial verification, per-finding reproduction, and suggested patches (worktree-validated, human-approved).

**C. Diff-aware / targeted:**

```bash
node <ARENA_HOME>/bin/arena-audit.mjs . --diff origin/main     # PR mode
node <ARENA_HOME>/bin/arena-audit.mjs . --target src/payments  # subtree
```

### 3. Read the results back to the user

- `arena-audit-out/index.html` — dashboard path.
- `REPORT.md` — executive verdict + verified/refuted/inconclusive findings.
- Overall score or honest `N/A` (coverage %) — never present "not checked" as a pass.

### In ZCode specifically

If the `CreateWorkflow` tool and a saved global workflow `arena-audit` exist, prefer:

```json
{ "name": "ممیزی آرنا — کل پروژه", "saved": { "name": "arena-audit" } }
```

Otherwise use the CLI above (it is the current generation of the engine).

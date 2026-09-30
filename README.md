# Arena Audit (`/arena-audit`)

> **Universal Multi-Agent Tournament Codebase Auditor**  
> Run thorough, attack/defend multi-agent audits on any codebase in **any AI harness**: ZCode, Claude Code, Cursor, Windsurf, Aider, GitHub Actions CI/CD, or standalone terminal.

---

## 🌟 Overview

`arena-audit` runs a rigorous, multi-agent audit on any codebase. Instead of trusting a single model's subjective or hallucinated advice, `arena-audit` orchestrates a 5-phase tournament:

```
┌────────────────────────────────────────────────────────┐
│             Stage 1: Machine Quality Gates             │
│   Executes actual project binaries: tsc / eslint /     │
│   vitest / jest. Records real exit codes and errors.   │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│             Stage 2: Dynamic Lens Extraction           │
│   Lead agent reads AGENTS.md, CLAUDE.md, README.md,    │
│   discovering 4–7 custom domain lenses & invariants.   │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│        Stage 3: Parallel Multi-Lens Specialists        │
│   Independent reviewer agents audit code concurrently   │
│   using exact line citations (path:line) and evidence. │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│        Stage 4: Independent Verifiers (Attack/Defend)  │
│   Each finding is handed to a separate, fresh agent    │
│   to independently reproduce/verify or discard it.     │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│             Stage 5: Principal Judge & Board           │
│   Deduplicates, sorts by severity, and renders a live  │
│   findings board + comprehensive markdown report.md.   │
└───────────────────────────┬────────────────────────────┘
```

---

## ⚡ Multi-Harness Compatibility

`arena-audit` is engineered to adapt automatically to whatever environment you run it in:

| Harness / Environment | Execution Method | Advantages |
| :--- | :--- | :--- |
| **ZCode** | Native Dynamic Workflow (`arena-audit.dwf.ts`) | Parallel subagents with smart caching, typed results, and live kanban board |
| **Claude Code** | `/arena-audit` Skill or CLI runner | Full terminal integration, runs via subagents or direct CLI |
| **Cursor / Windsurf** | Agent-mode or direct CLI | Works directly inside the IDE terminal |
| **Terminal / CI/CD** | `npx arena-audit` | Zero external dependencies; works with Anthropic, OpenAI, DeepSeek, Gemini, or local Ollama |

---

## 🚀 Quick Start

### 1. Terminal / CI/CD (Universal)

You don't need any pre-installation. Run directly with `npx` (requires Node.js >= 18):

```bash
# Run against any provider using your environment variables:
export ANTHROPIC_API_KEY="your-key"
# or export OPENAI_API_KEY="your-key"
# or export DEEPSEEK_API_KEY="your-key"

npx arena-audit
```

#### Running with local models (Ollama):
```bash
OLLAMA_HOST=http://localhost:11434 npx arena-audit --provider ollama --model llama3.1
```

#### Only checking machine gates (tsc, eslint, vitest):
```bash
npx arena-audit --gates-only
```

---

### 2. In ZCode

In any workspace, simply type:
```text
/arena-audit
```
Or in Persian:
> «این پروژه را با آرنا ممیزی کن»

ZCode will type-check the script and run the tournament in the background with live progress updates.

---

### 3. In Claude Code

Clone into your global or project skills directory:
```bash
git clone https://github.com/ali39999-hue/arena-audit.git ~/.agents/skills/arena-audit
```
Then use `/arena-audit` inside Claude Code.

---

## 🛡️ Why the Tournament Pattern?

1. **Elimination of False Positives:** Many LLM code reviews produce theoretical or outdated complaints. In `arena-audit`, a finding is only accepted if an independent verifier re-reads the actual code lines and reproduces the issue.
2. **Ground-Truth Machine Gates:** Real automated tests, linters, and type checkers are executed directly (`node_modules/typescript/bin/tsc`, `node_modules/eslint/bin/eslint.js`), grounding the AI in concrete facts.
3. **Repository-Specific Invariants:** Rather than applying generic web checklists, `arena-audit` dynamically reads your project's rules (`AGENTS.md`, `CLAUDE.md`, `package.json`) to audit what actually matters to your architecture.

---

## 📋 Deliverables

When the tournament completes, `arena-audit` outputs:
- `arena-audit-out/REPORT.md`: An executive markdown report with prioritized, verified issues.
- `arena-audit-out/findings.json`: Machine-readable results with gate statuses, line references, and verifier rationales.

---

## 📄 License

MIT © [ali39999-hue](https://github.com/ali39999-hue)

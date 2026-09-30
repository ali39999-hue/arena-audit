# 🛡️ Arena Audit (`/arena-audit`)

> **World-Class, Multi-Agent Tournament Codebase Auditor with Standalone Interactive UI**  
> Run rigorous, attack/defend multi-agent audits on any codebase across **any AI harness**: ZCode, Claude Code, Cursor, Windsurf, Aider, GitHub Actions CI/CD, or standalone terminal.

---

## 🌟 What Makes `arena-audit` World-Class?

While classic code reviewers produce noisy, hallucinated, or unverified opinions, `arena-audit` brings the **adversarial tournament model** to software auditing with **deterministic grounding**:

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
│       Stage 5: Principal Judge & Interactive UI        │
│   Calculates weighted rubric, renders a reactive HTML  │
│   dashboard, live kanban board & executive markdown.   │
└────────────────────────────────────────────────────────┘
```

---

## ⚔️ Comparison: `arena-audit` vs. `arena-skill`

| Capability | `arena-skill` (Original) | `arena-audit` (This Project) |
| :--- | :--- | :--- |
| **Primary Purpose** | Brute-force answer generation for single text prompts | **Comprehensive, production-grade codebase auditing** |
| **Ground Truth Floor** | ❌ None (pure LLM opinion debating LLM opinion) | **✅ Real Machine Gates** (`tsc`, `eslint`, `vitest`, `jest` with exit codes) |
| **Domain Awareness** | ❌ Generic prompt strategy combinations | **✅ Reads local rules** (`AGENTS.md`, `CLAUDE.md`, ADRs, architecture docs) |
| **Token Efficiency** | ⚠️ Wasteful (~595 agent calls in 70 waves) | **🎯 Laser-focused** (4–7 targeted specialist lenses + 1:1 verifiers) |
| **False-Positive Filtering** | Generic attack/defend debate | **Targeted adversarial verification** with exact line citation check |
| **User Interface** | ❌ Plain text files in `.arena/` | **🖥️ World-class standalone interactive HTML UI + Live Kanban** |
| **Harness Support** | Claude Code only | **Universal:** ZCode, Claude Code, Cursor, Windsurf, CI/CD, Terminal |
| **Dependencies** | Python 3.8+ required | **Zero dependencies** (Pure Node.js 18+ ESM) |

---

## 🖥️ Standalone Interactive Visual UI

In any environment, `arena-audit` generates a **gorgeous, reactive, single-page dashboard** (`arena-audit-out/index.html`) with zero external CDN dependencies (works 100% offline):

- **📊 Executive Scorecard:** Codebase Health Index (0–100), automated gate badges, and key metrics.
- **⚔️ Interactive Kanban Board:** Filter verified findings vs false positives by severity (Critical, High, Medium, Low) and domain lens.
- **🔍 Code Inspector & Evidence Modal:** Clickable `vscode://file/...` links that open the exact file and line in your editor with syntax-highlighted code evidence.
- **⚖️ Weighted Rubric Matrix:** Breakdown across Machine Integrity, Security, Domain Correctness, Architecture, and Standards.

---

## ⚡ Multi-Harness Compatibility

`arena-audit` seamlessly adapts to whatever environment you run it in:

| Harness / Environment | Execution Method | Advantages |
| :--- | :--- | :--- |
| **ZCode** | Native Dynamic Workflow (`arena-audit.dwf.ts`) | Parallel subagents with smart caching, typed results, and live kanban board |
| **Claude Code** | `/arena-audit` Skill or CLI runner | Full terminal integration, runs via subagents or direct CLI |
| **Cursor / Windsurf** | Agent-mode or direct CLI | Works directly inside the IDE terminal |
| **Terminal / CI/CD** | `npx arena-audit` | Zero external dependencies; works with Anthropic, OpenAI, DeepSeek, Gemini, or local Ollama |

---

## 🚀 Quick Start

### 1. Universal Terminal / CI/CD

Run directly with `npx` (requires Node.js >= 18):

```bash
# Run against any provider using your environment variables:
export ANTHROPIC_API_KEY="your-key"
# or export OPENAI_API_KEY="your-key"
# or export DEEPSEEK_API_KEY="your-key"
# or export GEMINI_API_KEY="your-key"

# Run audit and automatically open the interactive dashboard:
npx arena-audit --ui
```

#### Running with local models (Ollama):
```bash
OLLAMA_HOST=http://localhost:11434 npx arena-audit --provider ollama --model llama3.1 --ui
```

#### Fast machine-gates check only:
```bash
npx arena-audit --gates-only --ui
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

## 📋 Deliverables

When the tournament completes, `arena-audit` produces:
1. `arena-audit-out/index.html`: **Interactive Single-Page Visual Dashboard** (openable in any browser).
2. `arena-audit-out/REPORT.md`: An executive markdown report with prioritized, verified issues.
3. `arena-audit-out/findings.json`: Machine-readable results with gate statuses, line references, and verifier rationales.

---

## 📄 License

MIT © [ali39999-hue](https://github.com/ali39999-hue)

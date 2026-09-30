# Arena Audit (`/arena-audit`)

> **Multi-Agent Tournament Codebase Audit for ZCode & AI Coding Agents**  
> Inspired by the tournament pattern in `arena-skill`, adapted into a self-tuning **Dynamic Workflow** and reusable **Skill**.

---

## 🌟 Overview

`arena-audit` runs a rigorous, multi-agent audit on any codebase. Instead of a single LLM giving subjective or unverified advice, `arena-audit` sets up a multi-stage tournament:

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
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Advantages

- **Zero Hallucinations (Attack / Defend):** Every single bug candidate is challenged by a separate verifier subagent before reaching the final report.
- **Project-Aware (Not a Generic Linter):** Reads your repository's own `AGENTS.md` and architecture rules to audit what actually matters to your domain (e.g. financial precision, offline sync, auth tokens).
- **Hard Ground Truth:** Executes local binaries directly (`node_modules/typescript/bin/tsc`, `node_modules/eslint/bin/eslint.js`, etc.) to verify build and test health with real exit codes.
- **Universal:** Works out-of-the-box on any TypeScript, JavaScript, React, Node, or hybrid codebase.

---

## 📦 Installation

To use `/arena-audit` across all projects on your machine:

### Option A: Install via Git Clone

Clone directly into your global agent skills directory:

```bash
# Clone the skill
git clone https://github.com/ali39999-hue/arena-audit.git ~/.agents/skills/arena-audit

# Link or copy the workflow definition into your global workflows folder
mkdir -p ~/.zcode/workflows
cp ~/.agents/skills/arena-audit/workflows/arena-audit.dwf.ts ~/.zcode/workflows/
```

### Option B: Windows Manual Setup

1. Copy `SKILL.md` to:
   ```
   C:\Users\<YourUser>\.agents\skills\arena-audit\SKILL.md
   ```
2. Copy `workflows/arena-audit.dwf.ts` to:
   ```
   C:\Users\<YourUser>\.zcode\workflows\arena-audit.dwf.ts
   ```

---

## 💡 Usage

In any ZCode conversation (in any workspace), type:

```text
/arena-audit
```

Or speak in natural language:
- *"Audit this project with arena"*
- *"این پروژه را با آرنا ممیزی کن"*
- *"Run a full multi-agent codebase audit"*

The agent will automatically initiate the tournament workflow in the background and deliver the prioritized report upon completion.

---

## 📋 Artifacts Produced

1. **Live Kanban Board (`findings`):** Categorized by status (`تأیید شده` / `نیاز به بازبینی انسانی`) and severity (`بحرانی`, `متوسط`, `کم`).
2. **Markdown Deliverable (`report.md`):** Complete principal review report including:
   - Overall project health verdict.
   - Machine gates outcome (exit codes, error excerpts).
   - High, medium, and low priority actionable fixes.
   - Domain lens breakdowns.

---

## 📄 License

MIT © [ali39999-hue](https://github.com/ali39999-hue)

# 🛡️ Arena Audit v2 (`/arena-audit`)

> **Evidence-Anchored Multi-Agent Tournament Codebase Auditor**  
> Every claim is challenged, every finding is anchored to a hashed code excerpt, every gate is a real process exit code. Runs in **any AI harness**: ZCode, Claude Code, Cursor, Windsurf, CI/CD, or plain terminal.

---

## ✅ Capability Matrix (Integrity Reset — claims = implementation)

| Capability | Status | Evidence |
| :--- | :--- | :--- |
| Machine quality gates (tsc, eslint, vitest, jest, semgrep, gitleaks) with real exit codes | ✅ | `src/gates/registry.mjs` — plugin-style `detect()/run()`, normalized results |
| Repository intelligence without any LLM | ✅ | `src/intake/repo-snapshot.mjs` — indexer, languages, frameworks, pm, git, deps, tests, CI |
| Evidence Engine: every finding anchored to a SHA-256 hashed code excerpt | ✅ | `src/evidence/evidence-store.mjs` — unresolvable refs become `invalid`, never verified |
| Stale evidence detection (code changed → finding flips to `stale`) | ✅ | `isStale()` + final sweep in the runner |
| Verifier sees REAL code (excerpt + hash + gate results), decides `verified / refuted / inconclusive` with confidence | ✅ | `src/agents/agents.mjs::runVerifier` |
| True parallel specialists with bounded worker pool (never unbounded `Promise.all`) | ✅ | `src/core/concurrency.mjs::runPool` — one failed item costs one item |
| Finding fingerprint + cross-lens deduplication | ✅ | `src/findings/findings.mjs` |
| Scoring 2.0: `NOT CHECKED ≠ PASS` (no gates ⇒ overall = null + coverage %) | ✅ | `computeScores()` — unit tested |
| Sandbox: secrets stripped from child envs; untrusted repos refused without explicit trust | ✅ | `src/sandbox/policy.mjs` |
| Versioned audit contract (`audit-run.json`: runId, engine, model, commit, schema) | ✅ | `src/core/schemas.mjs` |
| Interactive HTML dashboard: Kanban board + rubric + filters, zero CDN, offline | ✅ | `src/dashboard.mjs` |
| Docker sandbox isolation, AST/semantic layer, SARIF, diff-aware audits, GitHub Checks | 🚧 Planned | See `docs/ARCHITECTURE.md` roadmap alignment |

## ⚔️ vs. `arena-skill` (original)

| | `arena-skill` | `arena-audit` v2 |
| :--- | :--- | :--- |
| Ground truth | None — LLM debates LLM | Real gates + hashed code evidence |
| Verification | Attack/defend debate on text | Adversarial verifier with actual excerpt + confidence |
| Parallelism | 70 sequential waves (~595 calls) | Bounded worker pool, targeted lenses (4–7) |
| False positives | Debated | Anchored or `invalid`; refuted kept & labeled |
| UI | Text logs in `.arena/` | Interactive offline dashboard + Kanban |
| Harness | Claude Code only | ZCode, Claude Code, Cursor, Windsurf, CI/CD, terminal |
| Deps | Python 3.8+ | Zero (Node 18+ only) |

---

## 🚀 Quick Start

### Universal (terminal / CI / any harness)

```bash
# Full tournament with any provider:
export ANTHROPIC_API_KEY=...        # or OPENAI_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY
npx arena-audit --ui                # opens the interactive dashboard when done

# Local models:
OLLAMA_HOST=http://localhost:11434 npx arena-audit --provider ollama --model llama3.1 --ui

# Machine gates only (real exit codes, dashboard included):
npx arena-audit --gates-only --ui

# Inside an AI harness without API keys — generate the tournament manifest
# for the host agent to execute:
npx arena-audit --agent-mode
```

### In ZCode
```text
/arena-audit
```

### In Claude Code
```bash
git clone https://github.com/ali39999-hue/arena-audit.git ~/.agents/skills/arena-audit
```
Then `/arena-audit`.

---

## 📋 Deliverables (`arena-audit-out/`)

| File | What it is |
| :--- | :--- |
| `index.html` | Interactive offline dashboard: health score (or honest `N/A`), live Kanban (تأیید شده / نیاز به بازبینی / رد شده), rubric matrix, filters, `vscode://` deep links |
| `audit-run.json` | Versioned manifest: runId, engine/model/commit, full evidence store, all findings with statuses |
| `findings.json` | Machine-readable scores + findings |
| `REPORT.md` | Executive verdict, priorities, verified/refuted/inconclusive breakdown, explicit not-covered section |

## 🧪 Development

```bash
npm test          # 29 zero-dependency unit tests (node:test)
npm run smoke     # self gates-only audit
```

## 📄 License

MIT © [ali39999-hue](https://github.com/ali39999-hue)

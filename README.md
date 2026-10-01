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
| **Docker sandbox executor**: network=none, read-only base FS, CPU/RAM/PID quotas, non-root, zero secrets (`--sandbox docker`) | ✅ | `src/sandbox/docker.mjs` — pure args builder, unit-tested |
| Remediation engine: **suggested** patches for verified findings, validated in an isolated git worktree with targeted tests — never auto-applied (`--remediate`) | ✅ | `src/remediation/patch.mjs` — `rejected`/`test_failed` are labeled states |
| Patch confidence: deterministic weighted factors (apply-clean, tests-passed, minimal-scope, evidence-aligned) — failed tests block "recommended" | ✅ | `src/remediation/confidence.mjs` |
| Human approval workflow: `patches` / `approve <id>` / `reject <id>` with audit-style who/when records; below-bar approvals blocked until `--force` | ✅ | `src/remediation/approval.mjs` |
| Baseline / regression intelligence: `--save-baseline` + `--baseline` classify findings as new/known/fixed; CI gates on **new** only | ✅ | `src/findings/baseline.mjs` |
| GitHub integration: Check Run + idempotent PR comment via `--github` (conclusion policy: known debt never blocks) | ✅ | `src/integrations/github.mjs` — pure payload builders, unit-tested |
| Observability: run-level trace with spans per gate/agent/LLM call → `telemetry.json` (honest cost note) | ✅ | `src/observability/telemetry.mjs` |
| **Control Plane (P15 v1)**: API server (ingest, findings query, triage, trends) + web dashboard, zero deps | ✅ | `node bin/arena-audit.mjs serve` — loopback by default, Bearer auth, public bind refused without token |
| CLI push: `--push <url>` ingests a run into a control plane (idempotent by runId) | ✅ | `bin/arena-audit.mjs` |
| Versioned audit contract (`audit-run.json`: runId, engine, model, commit, schema) | ✅ | `src/core/schemas.mjs` |
| Semantic layer without dependencies: symbol index, import graph, `findSymbol/findReferences/importedBy/impactOf` | ✅ | `src/semantic/symbols.mjs` — line-exact, evidence-anchorable |
| Diff-aware audit: `--diff [ref]` (PR mode) and `--target <path>` with honest scope accounting | ✅ | `src/git/delta.mjs` — findings outside scope dropped & counted |
| Impact analysis: changed files → transitive importers → related tests | ✅ | `semantic.impactOf()` |
| Reproduction engine: targeted test runs for verified findings (`--reproduce`) | ✅ | `src/verification/reproduce.mjs` — `not_reproducible` is a labeled state, never a silent pass |
| SARIF 2.1.0 output for GitHub Advanced Security / GitLab | ✅ | `src/outputs/sarif.mjs` → `report.sarif` |
| GitHub Action: diff-aware PR audit + SARIF upload | ✅ | `.github/workflows/arena-audit.yml` |
| Evaluation Lab: deterministic evidence benchmark (`npm run eval`) | ✅ | `src/evals/` + golden fixtures — precision/recall gates in CI-able script |
| Interactive HTML dashboard: Kanban board + rubric + filters, zero CDN, offline | ✅ | `src/dashboard.mjs` |
| Tree-sitter full AST, mutation testing, control plane / multi-tenancy | 🚧 Planned | See `docs/ARCHITECTURE.md` roadmap alignment |

### Sandbox modes

```bash
--sandbox trusted    # your repo; sanitized env (default)
--sandbox docker     # isolated container: no network, read-only base FS, quotas (image: node:22-bookworm-slim, override with ARENA_DOCKER_IMAGE)
--sandbox untrusted  # refuses tool execution unless ARENA_TRUST_REPO=1
```

### Remediation (suggested patches + human approval)

```bash
npx arena-audit --diff --remediate --ui
# → arena-out/patches/<id>.diff  +  arena-out/remediation.json
# Every patch: generated → git apply --check → applied in an isolated HEAD worktree
# → targeted tests run there → confidence factors printed (apply-clean 0.4,
#   tests-passed 0.3, minimal-scope 0.15, evidence-aligned 0.15).

npx arena-audit patches                     # list patches + confidence + approval state
npx arena-audit approve <id> --approver ali # records who/when; blocked below the bar unless --force
npx arena-audit reject <id> --reason "..."

# The engine NEVER applies a patch. After approval, a human deliberately runs:
git apply arena-audit-out/patches/<id>.diff
```

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

# PR / diff-aware audit (only changed files + their importers):
npx arena-audit --diff origin/main

# Targeted audit of a subtree:
npx arena-audit --target src/payments

# Run targeted tests for verified findings (reproduction):
npx arena-audit --diff --reproduce

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
| `audit-run.json` | Versioned manifest: runId, engine/model/commit, scope (diff/target), semantic stats, full evidence store, all findings with statuses |
| `report.sarif` | SARIF 2.1.0 for GitHub Advanced Security / GitLab / IDE integration |
| `findings.json` | Machine-readable scores + findings |
| `REPORT.md` | Executive verdict, priorities, verified/refuted/inconclusive breakdown, explicit not-covered section |

### Control Plane (P15 v1)

```bash
# Start the control plane (loopback, no token needed):
npx arena-audit serve
# Dashboard: http://localhost:7788/   ·   API: http://localhost:7788/api/health

# Public/hosted mode requires a token (refuses otherwise):
ARENA_API_TOKEN=sekrit npx arena-audit serve --host 0.0.0.0 --port 7788

# Push any audit run into the plane (idempotent by runId):
npx arena-audit --diff --ui --push http://localhost:7788
```

API surface: `POST /api/ingest` · `GET/POST /api/projects` · `GET /api/projects/:id/runs` · `GET /api/projects/:id/trends` · `GET /api/runs/:id` · `GET /api/findings?projectId=&status=&severity=&baselineState=` · `POST /api/findings/:id/resolve` (fixed | accepted_risk | false_positive | reopened | regressed) · `GET /api/health`

> Production scope note: the default store is a single JSON file for a local,
> single-process control plane. The store sits behind a narrow interface so a
> PostgreSQL adapter (P15-02, production) can replace it without touching the API.

## 🧪 Development

```bash
npm test          # 38 zero-dependency unit tests (node:test)
npm run eval      # deterministic evidence benchmark (precision/recall gates)
npm run smoke     # self gates-only audit
```

## 📄 License

MIT © [ali39999-hue](https://github.com/ali39999-hue)

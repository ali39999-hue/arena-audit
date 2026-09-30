#!/usr/bin/env node

/**
 * Arena Audit CLI — Universal Multi-Agent Tournament Codebase Auditor
 *
 * Runs anywhere Node.js >= 18 is installed:
 *   - Works in terminal (direct API via OpenAI, Anthropic, Gemini, DeepSeek, Ollama)
 *   - Works inside any AI Harness (Claude Code, Cursor, Windsurf, ZCode, Aider)
 *   - Generates interactive, standalone HTML Dashboard + Markdown + JSON
 *   - Zero external npm dependencies.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { generateDashboardHtml } from '../src/dashboard.mjs';

// --- Terminal Styles ---
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const color = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  red: isTTY ? '\x1b[31m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  blue: isTTY ? '\x1b[34m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
};

function banner() {
  console.log(`
${color.cyan}${color.bold}╔══════════════════════════════════════════════════════════════════╗
║               🛡️  ARENA AUDIT — UNIVERSAL RUNNER                ║
║      Multi-Agent Tournament Codebase Auditor for Any Harness     ║
╚══════════════════════════════════════════════════════════════════╝${color.reset}
`);
}

// --- Parse CLI Arguments ---
const args = process.argv.slice(2);
let targetDir = process.cwd();
let outputDir = resolve(targetDir, 'arena-audit-out');
let gatesOnly = false;
let agentMode = false;
let openUi = false;
let provider = process.env.ARENA_PROVIDER || null;
let modelName = process.env.ARENA_MODEL || null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  } else if (arg === '--gates-only') {
    gatesOnly = true;
  } else if (arg === '--agent-mode') {
    agentMode = true;
  } else if (arg === '--open' || arg === '--ui') {
    openUi = true;
  } else if (arg === '--output' || arg === '-o') {
    outputDir = resolve(process.cwd(), args[++i]);
  } else if (arg === '--provider' || arg === '-p') {
    provider = args[++i];
  } else if (arg === '--model' || arg === '-m') {
    modelName = args[++i];
  } else if (!arg.startsWith('-')) {
    targetDir = resolve(process.cwd(), arg);
  }
}

function printHelp() {
  console.log(`
Usage: npx arena-audit [path] [options]

Arguments:
  path                 Directory to audit (default: current directory)

Options:
  --gates-only         Only detect and run machine quality gates (tsc, lint, test)
  --agent-mode         Prepare structured tournament manifests for host AI agent
  --ui, --open         Automatically launch the interactive HTML dashboard in browser
  -o, --output <dir>   Output directory for reports (default: ./arena-audit-out)
  -p, --provider <p>   LLM provider (openai, anthropic, gemini, deepseek, ollama)
  -m, --model <name>   Override default model name
  -h, --help           Show this help message

Environment Variables:
  ANTHROPIC_API_KEY    Use Claude models directly
  OPENAI_API_KEY       Use OpenAI models directly
  GEMINI_API_KEY       Use Google Gemini models directly
  DEEPSEEK_API_KEY     Use DeepSeek models directly
  OLLAMA_HOST          Use local Ollama instance (default: http://localhost:11434)
`);
}

// --- Browser Launch Helper ---
function openInBrowser(targetPath) {
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      spawnSync('cmd.exe', ['/c', 'start', '""', targetPath], { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      spawnSync('open', [targetPath], { stdio: 'ignore' });
    } else {
      spawnSync('xdg-open', [targetPath], { stdio: 'ignore' });
    }
  } catch (_) {}
}

// --- SSRF & Host Security Validation ---
function isPrivateOrReservedHost(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '0.0.0.0') {
    return true;
  }
  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [_, a, b, c, d] = ipv4Match.map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
  }
  return false;
}

function safeValidateUrl(urlString, allowLocal = false) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    throw new Error(`Invalid URL: ${urlString}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Forbidden protocol '${parsed.protocol}'. Only http and https allowed.`);
  }
  if (!allowLocal && isPrivateOrReservedHost(parsed.hostname)) {
    throw new Error(`Security Exception: Host '${parsed.hostname}' is a localhost/private/reserved address.`);
  }
  return parsed;
}

async function safeFetch(urlString, options = {}, allowLocal = false) {
  safeValidateUrl(urlString, allowLocal);
  return await fetch(urlString, options);
}

// --- Provider Detection ---
function detectProvider() {
  if (provider) return provider.toLowerCase();
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.OLLAMA_HOST) return 'ollama';
  return null;
}

// --- Fallback Heuristic Lenses ---
const FALLBACK_LENSES = [
  {
    id: "correctness",
    title: "درستی منطقی و باگ‌های احتمالی",
    focus: "منطق اصلی دامنه، محاسبات حساس و وضعیت‌ها",
    checklist: [
      "حالت‌های مرزی (ورودی خالی، صفر، null) ایمن مدیریت شده باشد",
      "هیچ خطایی بی‌صدا بلعیده نشده باشد",
      "انواع داده و شرط‌ها با منطق کسب‌وکار سازگار باشد"
    ]
  },
  {
    id: "security",
    title: "امنیت داده‌ها و توکن‌ها",
    focus: "احراز هویت، کلیدها، اعتبارسنجی ورودی",
    checklist: [
      "هیچ توکن، کلید یا رمزی در کد هاردکد نشده باشد",
      "دسترسی به بخش‌های حساس محافظت شده باشد",
      "ورودی‌های بیرونی به صورت دقیق اعتبارسنجی شوند"
    ]
  },
  {
    id: "architecture",
    title: "معماری، جداسازی لایه‌ها و پایداری",
    focus: "ساختار ماژول‌ها و وابستگی‌ها",
    checklist: [
      "وابستگی‌ها یک‌طرفه و مطابق اصول معماری پروژه باشد",
      "منطق دامنه از جزئیات ظاهری یا زیرساختی تفکیک شده باشد",
      "پایداری و مقیاس‌پذیری ساختار حفظ شده باشد"
    ]
  },
  {
    id: "quality",
    title: "تست‌پذیری، پیکربندی و آمادگی استقرار",
    focus: "اسکریپت‌های تست، تنظیمات بیلد، CI",
    checklist: [
      "تست‌ها رفتار واقعی دامنه را پوشش دهند",
      "پیکربندی‌ها سالم و بدون تناقض باشند",
      "فایل‌های محلی و محیطی در .gitignore قرار داشته باشند"
    ]
  }
];

// --- Machine Quality Gates ---
function runMachineGates(cwd) {
  console.log(`${color.bold}[Phase 1] 🔍 Detecting and executing machine quality gates...${color.reset}`);
  
  const gates = [
    { name: 'typecheck', bin: 'node_modules/typescript/bin/tsc', args: ['--noEmit'] },
    { name: 'eslint', bin: 'node_modules/eslint/bin/eslint.js', args: ['.'] },
    { name: 'vitest', bin: 'node_modules/vitest/vitest.mjs', args: ['run'] },
    { name: 'jest', bin: 'node_modules/jest/bin/jest.js', args: [] },
  ];

  const results = [];
  let found = 0;

  for (const g of gates) {
    const fullBin = resolve(cwd, g.bin);
    if (!existsSync(fullBin)) continue;

    found++;
    process.stdout.write(`  Running gate ${color.cyan}${g.name}${color.reset}... `);
    const start = Date.now();
    try {
      const res = spawnSync(process.execPath, [fullBin, ...g.args], {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 300000,
      });

      const ok = res.status === 0;
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      if (ok) {
        console.log(`${color.green}PASSED ✓${color.reset} (${duration}s)`);
      } else {
        console.log(`${color.red}FAILED ✗${color.reset} (${duration}s)`);
      }

      results.push({
        name: g.name,
        ok,
        exitCode: res.status,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
      });
    } catch (err) {
      console.log(`${color.red}ERROR ✗${color.reset} (${err.message})`);
      results.push({
        name: g.name,
        ok: false,
        exitCode: -1,
        stdout: '',
        stderr: err.message,
      });
    }
  }

  if (found === 0) {
    console.log(`  ${color.dim}No standard machine gates (tsc, eslint, vitest, jest) detected in node_modules.${color.reset}`);
  }

  return results;
}

// --- Read Documentation Context ---
function extractDocsContext(cwd) {
  const docFiles = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'package.json'];
  let combined = '';
  for (const f of docFiles) {
    const p = resolve(cwd, f);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        combined += `\n\n--- [FILE: ${f}] ---\n` + content.slice(0, 10000);
      } catch (_) {}
    }
  }
  return combined;
}

// --- Unified LLM Calling (Zero Dependencies & Safe Fetch) ---
async function callLLM(providerName, systemPrompt, userPrompt) {
  const prov = providerName.toLowerCase();
  
  if (prov === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    const model = modelName || 'claude-3-5-sonnet-latest';
    const resp = await safeFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return data.content[0].text;
  }

  if (prov === 'openai' || prov === 'deepseek') {
    const isDeepSeek = prov === 'deepseek';
    const key = isDeepSeek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
    const url = isDeepSeek ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const model = modelName || (isDeepSeek ? 'deepseek-chat' : 'gpt-4o');
    const resp = await safeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`${prov} API error: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return data.choices[0].message.content;
  }

  if (prov === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    const model = modelName || 'gemini-1.5-pro-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const resp = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
        ],
      }),
    });
    if (!resp.ok) throw new Error(`Gemini API error: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
  }

  if (prov === 'ollama') {
    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = modelName || 'llama3.1';
    const resp = await safeFetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    }, true /* allow local for explicit Ollama setup */);
    if (!resp.ok) throw new Error(`Ollama API error: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return data.message.content;
  }

  throw new Error(`Unsupported provider: ${providerName}`);
}

function parseJSONFromText(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        throw new Error(`Failed to parse extracted JSON: ${e.message}`);
      }
    }
    throw new Error(`Could not find valid JSON in LLM response`);
  }
}

// --- Health Score & Rubric Calculator ---
function calculateScores(gates, findings) {
  let score = 100;

  // Deduct for failed machine gates (ground truth)
  for (const g of gates) {
    if (!g.ok) score -= 15;
  }

  // Deduct for verified findings
  const verified = findings.filter(f => f.status === 'verified');
  for (const f of verified) {
    if (f.severity === 'high') score -= 12;
    else if (f.severity === 'medium') score -= 6;
    else score -= 2;
  }

  score = Math.max(0, Math.min(100, score));

  // Compute Rubric Matrix
  const passedGates = gates.filter(g => g.ok).length;
  const machineGatesScore = gates.length > 0 ? Math.round((passedGates / gates.length) * 100) : 100;
  
  const highIssues = verified.filter(f => f.severity === 'high').length;
  const medIssues = verified.filter(f => f.severity === 'medium').length;

  const rubric = {
    machineGates: machineGatesScore,
    security: Math.max(0, 100 - (highIssues * 20)),
    correctness: Math.max(0, 100 - (medIssues * 15)),
    architecture: Math.max(0, 100 - (highIssues * 10 + medIssues * 5)),
    standards: machineGatesScore < 100 ? 75 : 95
  };

  return { score, rubric };
}

// --- Main Runner ---
async function main() {
  banner();
  console.log(`Target Directory: ${color.cyan}${targetDir}${color.reset}`);
  console.log(`Output Directory: ${color.cyan}${outputDir}${color.reset}\n`);

  mkdirSync(outputDir, { recursive: true });

  // 1. Run Machine Gates
  const gateResults = runMachineGates(targetDir);

  if (gatesOnly) {
    const { score, rubric } = calculateScores(gateResults, []);
    const html = generateDashboardHtml({
      project: basename(targetDir),
      score,
      gates: gateResults,
      lenses: FALLBACK_LENSES,
      findings: [],
      priorities: [],
      verdict: `بررسی گیت‌های ماشینی انجام شد (${gateResults.filter(g => g.ok).length} از ${gateResults.length} موفق).`,
      rubric
    });
    const htmlPath = join(outputDir, 'index.html');
    writeFileSync(htmlPath, html, 'utf-8');
    console.log(`\n${color.green}Dashboard generated: ${color.cyan}${htmlPath}${color.reset}`);
    if (openUi) openInBrowser(htmlPath);
    console.log(`${color.green}Gates check finished (--gates-only). Exiting.${color.reset}`);
    process.exit(0);
  }

  // 2. Determine execution mode
  const activeProvider = detectProvider();

  if (!activeProvider || agentMode) {
    console.log(`\n${color.yellow}[Harness Agent Mode Active]${color.reset}`);
    console.log(`No direct LLM API keys detected or --agent-mode specified.`);
    console.log(`Generating tournament manifests and interactive UI for your host AI agent...\n`);

    const docsContext = extractDocsContext(targetDir);
    const manifestPath = join(outputDir, 'tournament-manifest.json');
    const promptPath = join(outputDir, 'agent-instructions.md');
    const htmlPath = join(outputDir, 'index.html');

    const manifest = {
      project: basename(targetDir),
      gates: gateResults.map(g => ({ name: g.name, ok: g.ok, exitCode: g.exitCode })),
      recommendedLenses: FALLBACK_LENSES,
      docsSnippetAvailable: docsContext.length > 0,
    };

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const instructions = `# Arena Tournament Audit Instructions for AI Assistant

You are conducting an in-depth multi-agent Arena Audit for: **${basename(targetDir)}**.

## Machine Gates Status
${gateResults.map(g => `- **${g.name}**: ${g.ok ? '✅ PASSED' : '❌ FAILED (Exit Code: ' + g.exitCode + ')'}`).join('\n') || '- No automated gates detected.'}

## Step 1: Lens Formulation
Extract 4 to 7 domain-specific audit lenses from project rules (\`AGENTS.md\`, \`CLAUDE.md\`, \`README.md\`).

## Step 2: Parallel Specialists
For each lens, review the code and report findings with:
\`{ "path": "file:line", "problem": "...", "evidence": "...", "severity": "high|medium|low" }\`

## Step 3: Attack / Defend Independent Verification
Hand each candidate finding to a separate fresh subagent/prompt to independently verify or reject it.

## Step 4: Principal Judge & Final Report
Produce a markdown report in \`${join(outputDir, 'REPORT.md')}\` and update \`${htmlPath}\`.
`;

    writeFileSync(promptPath, instructions, 'utf-8');

    const { score, rubric } = calculateScores(gateResults, []);
    const initialHtml = generateDashboardHtml({
      project: basename(targetDir),
      score,
      gates: gateResults,
      lenses: FALLBACK_LENSES,
      findings: [],
      priorities: [],
      verdict: 'ممیزی در حال آماده‌سازی برای اجرا توسط دستیار هوش مصنوعی است.',
      rubric
    });
    writeFileSync(htmlPath, initialHtml, 'utf-8');

    console.log(`${color.green}✓ Tournament manifests and dashboard written:${color.reset}`);
    console.log(`  - Interactive UI: ${color.cyan}${htmlPath}${color.reset}`);
    console.log(`  - Manifest:       ${manifestPath}`);
    console.log(`  - Instructions:   ${promptPath}`);
    console.log(`\n${color.bold}How to proceed in your current AI Assistant:${color.reset}`);
    console.log(`  Tell your assistant: "Read ${promptPath} and perform the multi-agent tournament audit."\n`);

    if (openUi) openInBrowser(htmlPath);
    return;
  }

  // 3. Autonomous API Mode
  console.log(`\n${color.bold}[Phase 2] 🧠 Using Provider: ${color.cyan}${activeProvider}${color.reset}`);
  const docsContext = extractDocsContext(targetDir);

  // Extract Lenses
  console.log(`  Extracting tailored audit lenses from project documentation...`);
  let lenses = FALLBACK_LENSES;
  try {
    const lensPrompt = `You are a Principal Software Architect. Read the project context below and output 4 to 6 specialized audit lenses in strict JSON format:
{
  "projectName": "...",
  "projectDescription": "...",
  "lenses": [
    {
      "id": "latin-id",
      "title": "Title in Persian or English",
      "focus": "paths to focus on",
      "checklist": ["rule 1", "rule 2", "rule 3"]
    }
  ]
}

Project Context:
${docsContext.slice(0, 15000)}
`;
    const lensResponse = await callLLM(activeProvider, "Output only valid JSON.", lensPrompt);
    const parsed = parseJSONFromText(lensResponse);
    if (parsed.lenses && Array.isArray(parsed.lenses) && parsed.lenses.length > 0) {
      lenses = parsed.lenses;
    }
  } catch (err) {
    console.log(`  ${color.yellow}Notice: using robust default lenses (${err.message})${color.reset}`);
  }

  console.log(`  Configured ${color.cyan}${lenses.length}${color.reset} audit lenses.`);

  // Phase 3 & 4: Reviewers & Verifiers
  console.log(`\n${color.bold}[Phase 3 & 4] ⚔️  Reviewing & Attack/Defend Independent Verification...${color.reset}`);
  const verifiedFindings = [];

  for (const lens of lenses) {
    process.stdout.write(`  Auditing lens: ${color.cyan}${lens.title}${color.reset}... `);
    try {
      const reviewPrompt = `Audit the codebase from the perspective of lens: "${lens.title}".
Focus: ${lens.focus}
Checklist:
${lens.checklist.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Output strict JSON:
{
  "healthNote": "one summary sentence",
  "findings": [
    { "path": "relative/file.ts:line", "problem": "summary", "evidence": "quote", "severity": "high|medium|low" }
  ]
}`;
      const revText = await callLLM(activeProvider, "You are a senior auditor. Output only JSON.", reviewPrompt);
      const revData = parseJSONFromText(revText);
      const raw = revData.findings || [];
      console.log(`${color.green}${raw.length} candidates${color.reset}`);

      // Attack/defend verifier for each finding
      for (const f of raw.slice(0, 5)) {
        process.stdout.write(`    Verifying ${f.path}... `);
        try {
          const verPrompt = `Verify if this finding is genuine, reproducible and accurate:
Finding: ${JSON.stringify(f)}

Output strict JSON:
{
  "confirmed": true|false,
  "note": "verification rationale",
  "severity": "high|medium|low"
}`;
          const verText = await callLLM(activeProvider, "You are an independent adversary/verifier. Output only JSON.", verPrompt);
          const verData = parseJSONFromText(verText);
          if (verData.confirmed) {
            console.log(`${color.green}CONFIRMED ✓${color.reset}`);
            verifiedFindings.push({
              lens: lens.title,
              ...f,
              severity: verData.severity || f.severity,
              verifierNote: verData.note,
              status: 'verified',
            });
          } else {
            console.log(`${color.yellow}REFUTED ✗${color.reset}`);
            verifiedFindings.push({
              lens: lens.title,
              ...f,
              status: 'unconfirmed',
              verifierNote: verData.note || 'Rejected by independent verifier',
            });
          }
        } catch (_) {
          console.log(`${color.dim}SKIPPED${color.reset}`);
        }
      }
    } catch (err) {
      console.log(`${color.red}FAILED (${err.message})${color.reset}`);
    }
  }

  // Phase 5: Principal Judge
  console.log(`\n${color.bold}[Phase 5] ⚖️  Principal Judge Report Synthesis...${color.reset}`);
  let judgeSummary = "Audit completed.";
  let priorities = [];
  try {
    const judgePrompt = `You are the Principal Judge. Synthesize the findings below into an executive verdict and top priorities:
Machine Gates:
${JSON.stringify(gateResults.map(g => ({ name: g.name, ok: g.ok })))}

Findings:
${JSON.stringify(verifiedFindings)}

Output strict JSON:
{
  "verdict": "2-3 sentences executive summary in Persian",
  "priorities": [
    { "where": "file:line", "what": "issue summary in Persian", "severity": "high|medium|low" }
  ]
}`;
    const judgeText = await callLLM(activeProvider, "You are an impartial executive judge. Output only JSON.", judgePrompt);
    const parsedJudge = parseJSONFromText(judgeText);
    judgeSummary = parsedJudge.verdict || judgeSummary;
    priorities = parsedJudge.priorities || [];
  } catch (_) {}

  // Calculate Scores & Rubric
  const { score, rubric } = calculateScores(gateResults, verifiedFindings);

  // Write Deliverables
  const reportPath = join(outputDir, 'REPORT.md');
  const jsonPath = join(outputDir, 'findings.json');
  const htmlPath = join(outputDir, 'index.html');

  writeFileSync(jsonPath, JSON.stringify({ score, rubric, gates: gateResults, findings: verifiedFindings }, null, 2), 'utf-8');

  const md = `# Arena Tournament Codebase Audit Report

## ⚖️ Executive Verdict
${judgeSummary}

## 🚦 Machine Quality Gates
${gateResults.map(g => `- **${g.name}**: ${g.ok ? '✅ PASSED' : '❌ FAILED'}`).join('\n') || 'No machine gates tested.'}

## 🎯 Top Priorities
${priorities.map((p, i) => `${i + 1}. **\`${p.where}\`** — ${p.what} [${p.severity}]`).join('\n') || 'None recorded.'}

## 🔍 Verified Findings
${verifiedFindings.filter(f => f.status === 'verified').map(f => `- **[${f.severity.toUpperCase()}]** \`${f.path}\` — ${f.problem}\n  - *Evidence:* ${f.evidence}\n  - *Verifier Note:* ${f.verifierNote}`).join('\n\n') || 'No verified high-risk issues found.'}

## ⚠️ Unconfirmed / Refuted
${verifiedFindings.filter(f => f.status === 'unconfirmed').map(f => `- **[${f.severity}]** \`${f.path}\` — ${f.problem}\n  - *Note:* ${f.verifierNote}`).join('\n\n') || 'None.'}
`;

  writeFileSync(reportPath, md, 'utf-8');

  // Render Visual Interactive HTML Dashboard
  const html = generateDashboardHtml({
    project: basename(targetDir),
    score,
    gates: gateResults,
    lenses,
    findings: verifiedFindings,
    priorities,
    verdict: judgeSummary,
    rubric
  });

  writeFileSync(htmlPath, html, 'utf-8');

  console.log(`\n${color.green}${color.bold}🎉 Audit Complete!${color.reset}`);
  console.log(`  - 🌐 Interactive Dashboard: ${color.cyan}${htmlPath}${color.reset}`);
  console.log(`  - 📄 Markdown Report:       ${color.cyan}${reportPath}${color.reset}`);
  console.log(`  - 📦 Findings JSON:         ${color.cyan}${jsonPath}${color.reset}\n`);

  if (openUi) {
    console.log(`Opening interactive dashboard in your default browser...`);
    openInBrowser(htmlPath);
  }
}

main().catch(err => {
  console.error(`\n${color.red}Fatal Error: ${err.message}${color.reset}`);
  process.exit(1);
});

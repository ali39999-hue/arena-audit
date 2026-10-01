/**
 * Arena Audit — Semantic Intelligence Layer (P4-03, P4-06, P4-07, P4-09)
 *
 * Zero-dependency symbol & import-graph intelligence for JS/TS (+ basic
 * Python). The LLM-free query API lets specialists ask "who imports this?",
 * "where is this symbol?" and "what is the blast radius of this file?" —
 * with exact line numbers that double as evidence anchors.
 *
 * Honest scope: regex/structure heuristics, not a full AST parser.
 * Tree-sitter is the planned upgrade path (P4-01) without changing this API.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join, posix } from 'node:path';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// ---------------------------------------------------------------------------
// Symbol extraction (P4-03) — deterministic, line-exact.
// ---------------------------------------------------------------------------
const JS_SYMBOL_PATTERNS = [
  { re: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { re: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, kind: 'const' },
  { re: /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { re: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { re: /^\s*class\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { re: /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g, kind: 'const' },
];

const PY_SYMBOL_PATTERNS = [
  { re: /^\s*def\s+([A-Za-z_][\w]*)/g, kind: 'function' },
  { re: /^\s*class\s+([A-Za-z_][\w]*)/g, kind: 'class' },
];

/** Build a symbol index: { symbols: Map<name, [{file,line,kind}]>, fileSymbols: Map<file, [...]> } */
export function buildSymbolIndex(files, readRoot, { maxFileLines = 4000 } = {}) {
  const symbols = new Map();
  const fileSymbols = new Map();
  const codeFiles = [];

  for (const f of files) {
    const isJs = CODE_EXT.test(f.path);
    const isPy = f.path.endsWith('.py');
    if (!isJs && !isPy) continue;
    codeFiles.push(f.path);
    let content;
    try {
      content = readFileSync(resolve(readRoot, f.path), 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/).slice(0, maxFileLines);
    const patterns = isJs ? JS_SYMBOL_PATTERNS : PY_SYMBOL_PATTERNS;
    const inFile = [];
    for (let i = 0; i < lines.length; i++) {
      for (const { re, kind } of patterns) {
        re.lastIndex = 0;
        const m = re.exec(lines[i]);
        if (m) {
          const entry = { file: f.path, line: i + 1, kind };
          inFile.push({ name: m[1], ...entry });
          if (!symbols.has(m[1])) symbols.set(m[1], []);
          symbols.get(m[1]).push(entry);
        }
      }
    }
    if (inFile.length) fileSymbols.set(f.path, inFile);
  }
  return { symbols, fileSymbols, codeFiles };
}

// ---------------------------------------------------------------------------
// Import graph (P4-07) — relative imports resolved to workspace paths.
// ---------------------------------------------------------------------------
const IMPORT_RE = /(?:import\s+[^'"]*?from\s+|require\(\s*|import\s+)['"]([^'"]+)['"]/g;

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // external package — tracked separately
  const base = posix.normalize(posix.join(posix.dirname(fromFile.split('\\').join('/')), spec));
  // TS convention: `import './x.js'` may resolve to './x.ts' on disk.
  const stem = base.replace(/\.(js|mjs)$/, '');
  const candidates = [
    base,
    `${stem}.ts`, `${stem}.tsx`, `${stem}.jsx`,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`,
    posix.join(base, 'index.ts'), posix.join(base, 'index.js'),
  ];
  return candidates; // caller checks which exist in the file set
}

/** Build reverse import graph: Map<file, Set<importerFile>>. */
export function buildImportGraph(files, readRoot) {
  const known = new Set(files.map((f) => f.path));
  const importers = new Map(); // target -> Set<importer>
  const importsOf = new Map(); // importer -> Set<target>
  const externals = new Map(); // package -> Set<importer>

  for (const f of files) {
    if (!CODE_EXT.test(f.path)) continue;
    let content;
    try {
      content = readFileSync(resolve(readRoot, f.path), 'utf-8');
    } catch {
      continue;
    }
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(content))) {
      const spec = m[1];
      if (!spec.startsWith('.')) {
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!externals.has(pkg)) externals.set(pkg, new Set());
        externals.get(pkg).add(f.path);
        continue;
      }
      const candidates = resolveImport(f.path, spec);
      const hit = candidates.find((c) => known.has(c));
      if (hit) {
        if (!importers.has(hit)) importers.set(hit, new Set());
        importers.get(hit).add(f.path);
        if (!importsOf.has(f.path)) importsOf.set(f.path, new Set());
        importsOf.get(f.path).add(hit);
      }
    }
  }
  return { importers, importsOf, externals };
}

// ---------------------------------------------------------------------------
// Query API (P4-09) — every result is line-exact and evidence-anchorable.
// ---------------------------------------------------------------------------

export function createSemanticQueries(index, graph, root) {
  const { symbols, fileSymbols } = index;
  const { importers } = graph;

  return {
    /** find_symbol("createPayment") → [{file, line, kind}] */
    findSymbol(name) {
      return symbols.get(name) || [];
    },

    /** Symbols exported/defined in a file (for evidence context enrichment). */
    symbolsOf(file) {
      return (fileSymbols.get(file) || []).map((s) => `${s.name}(${s.kind}):${s.line}`);
    },

    /** Direct importers of a file. */
    importedBy(file) {
      return [...(importers.get(file) || [])];
    },

    /**
     * Impact analysis (P11-03): transitive importers up to `depth` levels.
     * Returns { direct: [], transitive: [], tests: [] } — paths only.
     */
    impactOf(changedFiles, { depth = 2, testPredicate = (p) => /(\.test\.|\.spec\.|\/tests?\/)/.test(p) } = {}) {
      const direct = new Set();
      const transitive = new Set();
      const frontier = [...changedFiles];
      for (let d = 0; d < depth; d++) {
        const next = [];
        for (const file of frontier) {
          for (const imp of importers.get(file) || []) {
            if (changedFiles.includes(imp) || direct.has(imp) || transitive.has(imp)) continue;
            if (d === 0) direct.add(imp); else transitive.add(imp);
            next.push(imp);
          }
        }
        frontier.length = 0;
        frontier.push(...next);
      }
      const all = [...direct, ...transitive];
      return {
        direct: [...direct],
        transitive: [...transitive],
        tests: all.filter(testPredicate),
      };
    },

    /** Line-exact occurrences of a token (bounded) — for find_references. */
    findReferences(token, { max = 20 } = {}) {
      const out = [];
      const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      for (const file of index.codeFiles) {
        let content;
        try {
          content = readFileSync(resolve(root, file), 'utf-8');
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && out.length < max; i++) {
          if (re.test(lines[i])) {
            const defs = fileSymbols.get(file) || [];
            const isDef = defs.some((d) => d.line === i + 1 && d.name === token);
            out.push({ file, line: i + 1, kind: isDef ? 'definition' : 'reference' });
          }
        }
      }
      return out;
    },
  };
}

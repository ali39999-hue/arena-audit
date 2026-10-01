/**
 * Arena Audit — Semantic Intelligence Layer (P4-01..P4-09)
 *
 * Tree-sitter AST parsing for JS/TS/TSX/Python with seamless heuristic regex fallback.
 *
 * Provides:
 *  - AST-backed symbol indexing (functions, classes, methods, types, consts)
 *  - Scope-aware symbol resolution and caller/callee relationships
 *  - Import/Export dependency graph
 *  - Line/span evidence anchoring from AST
 *  - Fallback to heuristic parser if AST is unavailable or on malformed files
 *  - 100% backward-compatible Query API
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, posix } from 'node:path';
import { parseSourceToAstSync, initTreeSitter, isTreeSitterAvailable } from './ast.mjs';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// ---------------------------------------------------------------------------
// Heuristic patterns (Fallback Layer)
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

/**
 * Heuristic symbol extraction fallback.
 */
function extractSymbolsHeuristic(content, filePath) {
  const isJs = CODE_EXT.test(filePath);
  const lines = content.split(/\r?\n/).slice(0, 4000);
  const patterns = isJs ? JS_SYMBOL_PATTERNS : PY_SYMBOL_PATTERNS;
  const inFile = [];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, kind } of patterns) {
      re.lastIndex = 0;
      const m = re.exec(lines[i]);
      if (m) {
        inFile.push({
          name: m[1],
          line: i + 1,
          endLine: i + 1,
          kind,
          isExported: lines[i].includes('export'),
          scope: 'global',
          file: filePath,
          origin: 'heuristic',
        });
      }
    }
  }
  return inFile;
}

/**
 * Build symbol index: AST-first with deterministic heuristic fallback.
 */
export function buildSymbolIndex(files, readRoot, { maxFileLines = 4000 } = {}) {
  const symbols = new Map();
  const fileSymbols = new Map();
  const astCalls = new Map();
  const astScopes = new Map();
  const codeFiles = [];
  let astCount = 0;
  let fallbackCount = 0;

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

    // Try AST parsing first
    let astAnalysis = null;
    try {
      astAnalysis = parseSourceToAstSync(f.path, content);
    } catch {
      astAnalysis = null;
    }

    let inFile = [];
    if (astAnalysis && astAnalysis.symbols && astAnalysis.symbols.length > 0) {
      inFile = astAnalysis.symbols;
      if (astAnalysis.calls && astAnalysis.calls.length > 0) {
        astCalls.set(f.path, astAnalysis.calls);
      }
      if (astAnalysis.scopes && astAnalysis.scopes.length > 0) {
        astScopes.set(f.path, astAnalysis.scopes);
      }
      astCount++;
    } else {
      // Graceful fallback to regex heuristics
      inFile = extractSymbolsHeuristic(content, f.path);
      fallbackCount++;
    }

    for (const s of inFile) {
      if (!symbols.has(s.name)) symbols.set(s.name, []);
      symbols.get(s.name).push(s);
    }

    if (inFile.length) fileSymbols.set(f.path, inFile);
  }

  return {
    symbols,
    fileSymbols,
    codeFiles,
    astCalls,
    astScopes,
    stats: { totalFiles: codeFiles.length, astParsed: astCount, fallbackParsed: fallbackCount },
  };
}

/**
 * Async version that ensures Tree-sitter is initialized before building index.
 */
export async function buildSymbolIndexAsync(files, readRoot, opts = {}) {
  await initTreeSitter();
  return buildSymbolIndex(files, readRoot, opts);
}

// ---------------------------------------------------------------------------
// Import graph
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

    // Try reading imports from AST cache first
    let importedSources = [];
    const ast = parseSourceToAstSync(f.path, content);
    if (ast && ast.imports && ast.imports.length > 0) {
      importedSources = ast.imports.map((i) => i.source);
    } else {
      // Regex fallback
      IMPORT_RE.lastIndex = 0;
      let m;
      while ((m = IMPORT_RE.exec(content))) {
        importedSources.push(m[1]);
      }
    }

    for (const spec of importedSources) {
      if (!spec) continue;
      if (!spec.startsWith('.')) {
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!externals.has(pkg)) externals.set(pkg, new Set());
        externals.get(pkg).add(f.path);
        continue;
      }
      const candidates = resolveImport(f.path, spec);
      const hit = candidates ? candidates.find((c) => known.has(c)) : null;
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
// Query API (P4-09) — 100% backward compatible + AST extensions
// ---------------------------------------------------------------------------

export function createSemanticQueries(index, graph, root) {
  const { symbols, fileSymbols, astCalls = new Map(), astScopes = new Map(), codeFiles = [] } = index;
  const { importers } = graph;

  // Build callers/callees index from AST calls
  const callersMap = new Map(); // calleeName -> [{ caller, file, line }]
  const calleesMap = new Map(); // callerName -> [{ callee, file, line }]

  for (const [file, calls] of astCalls.entries()) {
    for (const c of calls) {
      if (!callersMap.has(c.callee)) callersMap.set(c.callee, []);
      callersMap.get(c.callee).push({ caller: c.caller, file, line: c.line });

      const callerKey = `${file}:${c.caller}`;
      if (!calleesMap.has(callerKey)) calleesMap.set(callerKey, []);
      calleesMap.get(callerKey).push({ callee: c.callee, file, line: c.line });
    }
  }

  return {
    /** find_symbol("createPayment") → [{file, line, endLine, kind, isExported, scope, origin}] */
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
      const targetFiles = codeFiles.length > 0 ? codeFiles : [...fileSymbols.keys()];

      for (const file of targetFiles) {
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

    // ── AST-Backed Extensions (P4-05, P4-08, P4-09) ─────────────────────────

    /**
     * Get all callers of a function based on AST call expressions.
     */
    getCallers(calleeName) {
      return callersMap.get(calleeName) || [];
    },

    /**
     * Get all callees called by a function in a specific file.
     */
    getCallees(callerName, file = null) {
      if (file) {
        return calleesMap.get(`${file}:${callerName}`) || [];
      }
      const all = [];
      for (const [key, list] of calleesMap.entries()) {
        if (key.endsWith(`:${callerName}`)) all.push(...list);
      }
      return all;
    },

    /**
     * Get the enclosing AST scope (function, class, method) for a file and line number.
     * Returns the most specific (innermost) scope containing the line.
     */
    getScope(file, line) {
      const scopes = astScopes.get(file);
      if (!scopes || !scopes.length) return 'global';
      // Find the deepest (innermost / shortest span) enclosing scope
      const enclosing = scopes
        .filter((s) => s.startLine <= line && s.endLine >= line)
        .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
      return enclosing.length > 0 ? enclosing[0].name : 'global';
    },

    /**
     * Structural query: filter symbols by kind, export status, scope, or file.
     */
    structuralQuery({ kind, isExported, file, scope } = {}) {
      const results = [];
      for (const list of fileSymbols.values()) {
        for (const s of list) {
          if (kind && s.kind !== kind) continue;
          if (isExported !== undefined && s.isExported !== isExported) continue;
          if (file && s.file !== file) continue;
          if (scope && s.scope !== scope) continue;
          results.push(s);
        }
      }
      return results;
    },

    /**
     * AST-anchored line and span extraction for precise evidence anchoring.
     */
    astAnchor(symbolName, file = null) {
      const hits = symbols.get(symbolName) || [];
      if (!hits.length) return null;
      const target = file ? hits.find((h) => h.file === file) || hits[0] : hits[0];
      return {
        file: target.file,
        startLine: target.line,
        endLine: target.endLine || target.line,
        kind: target.kind,
        scope: target.scope,
        origin: target.origin || 'heuristic',
      };
    },

    /**
     * Status indicator for the semantic engine.
     */
    isAstAvailable() {
      return isTreeSitterAvailable();
    },
  };
}

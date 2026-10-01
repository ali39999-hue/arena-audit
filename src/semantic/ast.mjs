/**
 * Arena Audit — Tree-sitter AST Engine (P4-01, P4-02, P4-03, P4-07)
 *
 * Real AST parsing for JavaScript, TypeScript, TSX, and Python using
 * web-tree-sitter and precompiled wasm grammars.
 *
 * Provides:
 *  - Lazy init with deterministic fallback
 *  - Synchronous parsing after initialization
 *  - AST cache with content-hash invalidation
 *  - Scope-aware AST visitor for definitions, calls, imports, exports, references
 *  - Structural queries (callers, callees, scopes) without breaking existing API
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

let ParserClass = null;
let parserInstance = null;
const languages = new Map();
let isInitialized = false;
let initFailed = false;
let initError = null;

// AST cache: Map<contentHash, { tree, symbols, imports, exports, calls, references, scopes }>
const astCache = new Map();
const MAX_CACHE_SIZE = 1000;

function hashContent(text) {
  return createHash('sha256').update(text || '', 'utf-8').digest('hex');
}

/**
 * Locate wasm grammars directory.
 */
function getWasmDir() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(currentDir, '..', '..', 'node_modules', 'tree-sitter-wasms', 'out');
  if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Lazy init Tree-sitter parser and core grammars.
 * Returns true if AST parsing is available, false if fallback must be used.
 */
export async function initTreeSitter() {
  if (isInitialized) return true;
  if (initFailed) return false;

  try {
    const wasmDir = getWasmDir();
    if (!wasmDir) {
      initFailed = true;
      initError = 'tree-sitter-wasms directory not found';
      return false;
    }

    const mod = await import('web-tree-sitter');
    ParserClass = mod.default || mod;
    await ParserClass.init();

    parserInstance = new ParserClass();

    // Preload JavaScript and TypeScript wasm grammars
    const jsWasm = join(wasmDir, 'tree-sitter-javascript.wasm');
    const tsWasm = join(wasmDir, 'tree-sitter-typescript.wasm');
    const tsxWasm = join(wasmDir, 'tree-sitter-tsx.wasm');
    const pyWasm = join(wasmDir, 'tree-sitter-python.wasm');

    if (existsSync(jsWasm)) {
      const jsLang = await ParserClass.Language.load(jsWasm);
      languages.set('.js', jsLang);
      languages.set('.mjs', jsLang);
      languages.set('.cjs', jsLang);
      languages.set('.jsx', jsLang);
    }

    if (existsSync(tsWasm)) {
      const tsLang = await ParserClass.Language.load(tsWasm);
      languages.set('.ts', tsLang);
    }

    if (existsSync(tsxWasm)) {
      const tsxLang = await ParserClass.Language.load(tsxWasm);
      languages.set('.tsx', tsxLang);
    }

    if (existsSync(pyWasm)) {
      const pyLang = await ParserClass.Language.load(pyWasm);
      languages.set('.py', pyLang);
    }

    isInitialized = true;
    return true;
  } catch (err) {
    initFailed = true;
    initError = err.message;
    return false;
  }
}

/**
 * Check if AST engine is available and initialized.
 */
export function isTreeSitterAvailable() {
  return isInitialized && !initFailed;
}

/**
 * Get init error if any.
 */
export function getTreeSitterError() {
  return initError;
}

/**
 * Select Tree-sitter language for a file path.
 */
export function getLanguageForFile(filePath) {
  const ext = extname(filePath || '').toLowerCase();
  return languages.get(ext) || null;
}

/**
 * Parse code into an AST tree synchronously (if initialized) with caching.
 * Returns null if uninitialized, parsing failed, or language unsupported.
 */
export function parseSourceToAstSync(filePath, content) {
  if (!isInitialized || initFailed || !parserInstance) return null;

  const lang = getLanguageForFile(filePath);
  if (!lang) return null;

  const contentHash = hashContent(content);
  if (astCache.has(contentHash)) {
    return astCache.get(contentHash);
  }

  try {
    parserInstance.setLanguage(lang);
    const tree = parserInstance.parse(content);
    if (!tree || !tree.rootNode) return null;

    const analysis = analyzeAst(filePath, tree, content);
    const result = { tree, contentHash, ...analysis };

    if (astCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = astCache.keys().next().value;
      astCache.delete(oldestKey);
    }
    astCache.set(contentHash, result);

    return result;
  } catch {
    return null;
  }
}

/**
 * Parse code into an AST tree asynchronously (initializes if needed).
 */
export async function parseSourceToAst(filePath, content) {
  const available = await initTreeSitter();
  if (!available) return null;
  return parseSourceToAstSync(filePath, content);
}

/**
 * Clean up AST cache.
 */
export function clearAstCache() {
  astCache.clear();
}

/**
 * Scope-aware AST analysis for a single file.
 */
function analyzeAst(filePath, tree, content) {
  const symbols = [];      // { name, line, endLine, kind, isExported, scope, file }
  const imports = [];      // { source, specifiers, line, file }
  const exports = [];      // { name, line, kind, file }
  const calls = [];        // { caller, callee, line, file }
  const references = [];   // { name, line, kind, file }
  const scopes = [];       // { name, kind, startLine, endLine }

  const lines = content.split(/\r?\n/);

  // Scope tracking stack
  const scopeStack = [{ name: 'global', kind: 'module', line: 1 }];

  function currentScope() {
    return scopeStack[scopeStack.length - 1];
  }

  function walk(node) {
    if (!node) return;

    const type = node.type;
    const startRow = node.startPosition.row + 1; // 1-based line
    const endRow = node.endPosition.row + 1;

    let pushedScope = false;

    // 1. Function declarations
    if (type === 'function_declaration' || type === 'generator_function_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'anonymous';
      const isExported = node.parent && node.parent.type === 'export_statement';
      symbols.push({
        name,
        line: startRow,
        endLine: endRow,
        kind: 'function',
        isExported,
        scope: currentScope().name,
        file: filePath,
        origin: 'ast',
      });
      references.push({ name, line: startRow, kind: 'definition', file: filePath });
      scopes.push({ name, kind: 'function', startLine: startRow, endLine: endRow });
      scopeStack.push({ name, kind: 'function', line: startRow });
      pushedScope = true;
    }
    // 2. Class declarations
    else if (type === 'class_declaration' || type === 'abstract_class_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'anonymous';
      const isExported = node.parent && node.parent.type === 'export_statement';
      symbols.push({
        name,
        line: startRow,
        endLine: endRow,
        kind: 'class',
        isExported,
        scope: currentScope().name,
        file: filePath,
        origin: 'ast',
      });
      references.push({ name, line: startRow, kind: 'definition', file: filePath });
      scopes.push({ name, kind: 'class', startLine: startRow, endLine: endRow });
      scopeStack.push({ name, kind: 'class', line: startRow });
      pushedScope = true;
    }
    // 3. Methods inside class
    else if (type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        symbols.push({
          name,
          line: startRow,
          endLine: endRow,
          kind: 'method',
          isExported: false,
          scope: currentScope().name,
          file: filePath,
          origin: 'ast',
        });
        references.push({ name, line: startRow, kind: 'definition', file: filePath });
        scopes.push({ name, kind: 'method', startLine: startRow, endLine: endRow });
      }
      scopeStack.push({ name: nameNode ? nameNode.text : 'method', kind: 'method', line: startRow });
      pushedScope = true;
    }
    // 4. Interface / Type alias declarations (TypeScript)
    else if (type === 'interface_declaration' || type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        const isExported = node.parent && node.parent.type === 'export_statement';
        symbols.push({
          name,
          line: startRow,
          endLine: endRow,
          kind: type === 'interface_declaration' ? 'interface' : 'type',
          isExported,
          scope: currentScope().name,
          file: filePath,
          origin: 'ast',
        });
        references.push({ name, line: startRow, kind: 'definition', file: filePath });
      }
    }
    // 5. Variable declarations (const / let / var)
    else if (type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const valueNode = node.childForFieldName('value');
      if (nameNode) {
        const name = nameNode.text;
        const isFn = valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression');
        const isExported = node.parent && node.parent.parent && node.parent.parent.type === 'export_statement';
        symbols.push({
          name,
          line: startRow,
          endLine: endRow,
          kind: isFn ? 'function' : 'const',
          isExported,
          scope: currentScope().name,
          file: filePath,
          origin: 'ast',
        });
        references.push({ name, line: startRow, kind: 'definition', file: filePath });

        if (isFn) {
          scopes.push({ name, kind: 'function', startLine: startRow, endLine: endRow });
          scopeStack.push({ name, kind: 'function', line: startRow });
          pushedScope = true;
        }
      }
    }
    // 6. Import statements
    else if (type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      const source = sourceNode ? sourceNode.text.replace(/['"]/g, '') : '';
      const specifiers = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'import_clause') {
          specifiers.push(child.text);
        }
      }
      imports.push({ source, specifiers, line: startRow, file: filePath });
    }
    // 7. Export statements
    else if (type === 'export_statement') {
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const declName = declaration.childForFieldName && declaration.childForFieldName('name');
        if (declName) {
          exports.push({ name: declName.text, line: startRow, file: filePath });
        }
      }
    }
    // 8. Call expressions (Caller / Callee resolution)
    else if (type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      if (functionNode) {
        const fullCallee = functionNode.text;
        let calleeName = fullCallee;
        if (functionNode.type === 'member_expression') {
          const prop = functionNode.childForFieldName('property');
          if (prop) calleeName = prop.text;
        }
        const caller = currentScope().name;
        calls.push({ caller, callee: calleeName, fullCallee, line: startRow, file: filePath });
        references.push({ name: calleeName, line: startRow, kind: 'call', file: filePath });
      }
    }
    // 9. Python function and class definitions
    else if (type === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'anonymous';
      symbols.push({
        name,
        line: startRow,
        endLine: endRow,
        kind: 'function',
        isExported: !name.startsWith('_'),
        scope: currentScope().name,
        file: filePath,
        origin: 'ast',
      });
      references.push({ name, line: startRow, kind: 'definition', file: filePath });
      scopes.push({ name, kind: 'function', startLine: startRow, endLine: endRow });
      scopeStack.push({ name, kind: 'function', line: startRow });
      pushedScope = true;
    }

    // Traverse children
    for (let i = 0; i < node.namedChildCount; i++) {
      walk(node.namedChild(i));
    }

    if (pushedScope) {
      scopeStack.pop();
    }
  }

  walk(tree.rootNode);

  return { symbols, imports, exports, calls, references, scopes };
}

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initTreeSitter, isTreeSitterAvailable, parseSourceToAst, clearAstCache } from '../../src/semantic/ast.mjs';
import { buildSymbolIndexAsync, buildImportGraph, createSemanticQueries, buildSymbolIndex } from '../../src/semantic/symbols.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenRoot = resolve(__dirname, '..', 'fixtures', 'semantic-golden');

before(async () => {
  await initTreeSitter();
});

test('Tree-sitter initialization succeeds and is available', () => {
  assert.equal(isTreeSitterAvailable(), true, 'Tree-sitter must be initialized');
});

test('parseSourceToAst produces AST and scope analysis with caching', async () => {
  clearAstCache();
  const sample = `
  export function compute(x: number): number {
    return x * 2;
  }
  `;
  const ast1 = await parseSourceToAst('calc.ts', sample);
  assert.ok(ast1, 'AST must be generated');
  assert.equal(ast1.symbols.length, 1);
  assert.equal(ast1.symbols[0].name, 'compute');
  assert.equal(ast1.symbols[0].kind, 'function');
  assert.equal(ast1.symbols[0].isExported, true);

  // Cache hit test
  const ast2 = await parseSourceToAst('calc.ts', sample);
  assert.equal(ast1.contentHash, ast2.contentHash);
  assert.equal(ast1, ast2, 'cached AST object must be returned');
});

test('AST parsing extracts rich symbols from TypeScript golden fixtures', async () => {
  const files = [
    { path: 'processor.ts', kind: 'source' },
    { path: 'models.ts', kind: 'source' },
  ];

  const symIndex = await buildSymbolIndexAsync(files, goldenRoot);
  assert.ok(symIndex.stats.astParsed >= 2, 'both files should be parsed with AST');

  const graph = buildImportGraph(files, goldenRoot);
  const semantic = createSemanticQueries(symIndex, graph, goldenRoot);

  // Symbol resolution
  const procSyms = semantic.findSymbol('PaymentProcessor');
  assert.equal(procSyms.length, 1);
  assert.equal(procSyms[0].kind, 'class');
  assert.equal(procSyms[0].isExported, true);
  assert.equal(procSyms[0].origin, 'ast');
  assert.ok(procSyms[0].endLine > procSyms[0].line, 'span endLine must be greater than start line');

  // Interface extraction
  const userIface = semantic.findSymbol('User');
  assert.equal(userIface.length, 1);
  assert.equal(userIface[0].kind, 'interface');

  // Method extraction inside class
  const procMethod = semantic.findSymbol('processPayment');
  assert.equal(procMethod.length, 1);
  assert.equal(procMethod[0].kind, 'method');
  assert.equal(procMethod[0].scope, 'PaymentProcessor');

  // AST-backed caller/callee resolution
  const callers = semantic.getCallers('executeTransaction');
  assert.ok(callers.length > 0, 'executeTransaction must have callers');
  assert.equal(callers[0].caller, 'processPayment');

  const callees = semantic.getCallees('processPayment', 'processor.ts');
  assert.ok(callees.some(c => c.callee.includes('getUser')));
  assert.ok(callees.some(c => c.callee.includes('executeTransaction')));

  // Enclosing scope lookup
  const scopeInsideMethod = semantic.getScope('processor.ts', procMethod[0].line + 1);
  assert.equal(scopeInsideMethod, 'processPayment');

  // Structural queries
  const exportedClasses = semantic.structuralQuery({ kind: 'class', isExported: true });
  assert.ok(exportedClasses.some(c => c.name === 'PaymentProcessor'));
  assert.ok(exportedClasses.some(c => c.name === 'UserService'));

  // AST Evidence Anchoring
  const anchor = semantic.astAnchor('PaymentProcessor');
  assert.ok(anchor);
  assert.equal(anchor.file, 'processor.ts');
  assert.equal(anchor.kind, 'class');
  assert.equal(anchor.origin, 'ast');
  assert.ok(anchor.endLine >= anchor.startLine);

  // Backward compatibility: importedBy and impactOf
  const modelsImporters = semantic.importedBy('models.ts');
  assert.ok(modelsImporters.includes('processor.ts'));

  const impact = semantic.impactOf(['models.ts']);
  assert.ok(impact.direct.includes('processor.ts'));
});

test('Fallback to heuristic works seamlessly when AST is bypassed', () => {
  const files = [
    { path: 'processor.ts', kind: 'source' },
  ];
  // buildSymbolIndex without prior init / simulated fallback
  const symIndex = buildSymbolIndex(files, goldenRoot);
  assert.ok(symIndex.symbols.size > 0);
  const proc = symIndex.symbols.get('PaymentProcessor');
  assert.ok(proc);
  assert.ok(proc[0].origin === 'ast' || proc[0].origin === 'heuristic');
});

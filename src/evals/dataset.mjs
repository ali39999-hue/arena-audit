/**
 * Arena Audit — Evaluation Dataset Generator (P10-02, P10-03)
 *
 * Programmatically seeds a benchmark repository: real-looking bug cases
 * (one per planted bug, line-exact) + false-positive traps (clean code that
 * must NOT fire). Seeded RNG → the same seed produces the same dataset,
 * which is what makes benchmark numbers repeatable (P10 gate).
 *
 * Secret-shaped strings are built by concatenation at generation time so no
 * literal credential ever exists in this repository's source.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** mulberry32 — tiny seeded PRNG. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One template per detector. build(variant) → { content, bugLine } (1-based).
export const TEMPLATES = {
  'hardcoded-credential': {
    category: 'security', severity: 'high',
    build(variant) {
      const prefix = variant % 2 === 0 ? 'sk_' : 'pk_';
      const env = variant % 2 === 0 ? 'live' : 'test';
      const fake = Array.from({ length: 24 }, (_, k) => 'ABCDEFGHIJ'[k % 10]).join('');
      const lines = [
        '// payment client',
        `const config = { retries: ${variant} };`,
        `const apiKey = "${prefix}${env}_${fake}";`,
        'export const client = { config };',
      ];
      return { content: lines.join('\n'), bugLine: 3 };
    },
  },
  'eval-usage': {
    category: 'security', severity: 'high',
    build(variant) {
      const lines = [
        '// expression runner',
        `const field = "f${variant}";`,
        'export function run(expr) {',
        '  return eval(expr);',
        '}',
      ];
      return { content: lines.join('\n'), bugLine: 4 };
    },
  },
  'sql-string-concat': {
    category: 'security', severity: 'high',
    build(variant) {
      const table = variant % 2 === 0 ? 'users' : 'orders';
      const lines = [
        '// legacy query builder',
        `export function find(id) {`,
        `  const q = "SELECT * FROM ${table} WHERE id = " + id;`,
        '  return db.exec(q);',
        '}',
      ];
      return { content: lines.join('\n'), bugLine: 3 };
    },
  },
  'dangerous-html': {
    category: 'security', severity: 'high',
    build(variant) {
      const lines = [
        `// comment widget ${variant}`,
        'export function Comment({ html }) {',
        '  return <div dangerouslySetInnerHTML={{ __html: html }} />;',
        '}',
      ];
      return { content: lines.join('\n'), bugLine: 3 };
    },
  },
  'localstorage-token': {
    category: 'security', severity: 'high',
    build(variant) {
      const lines = [
        `// session v${variant}`,
        'export function persist(token) {',
        "  localStorage.setItem('auth-token', token);",
        '}',
      ];
      return { content: lines.join('\n'), bugLine: 3 };
    },
  },
  'empty-catch': {
    category: 'reliability', severity: 'medium',
    build(variant) {
      const lines = [
        `// importer ${variant}`,
        'export function load() {',
        '  try {',
        '    return read();',
        `  } catch (e${variant}) {}`,
        '}',
      ];
      return { content: lines.join('\n'), bugLine: 5 };
    },
  },
  'money-float-math': {
    category: 'correctness', severity: 'medium',
    build(variant) {
      const lines = [
        `// pricing rule ${variant}`,
        'export function apply(price) {',
        `  return price * 1.${variant}0;`,
        '}',
      ];
      return { content: lines.join('\n'), bugLine: 3 };
    },
  },
  'py-eval-usage': {
    category: 'security', severity: 'high',
    build(variant) {
      const lines = [
        `# runner ${variant}`,
        'def run(expr):',
        '    return eval(expr)',
      ];
      return { content: lines.join('\n'), bugLine: 3 };
    },
  },
};

// Clean analogues that must NOT fire (false-positive traps).
const CLEAN_FILES = [
  { file: 'src/clean/token.ts', content: 'export const t = token({ expires: 3600 });\n' },
  { file: 'src/clean/theme.ts', content: "localStorage.setItem('ui-theme', 'dark');\n" },
  { file: 'src/clean/math.ts', content: 'export const total = items.length * 2;\n' },
  { file: 'src/clean/handler.ts', content: 'try {\n  go();\n} catch (err) {\n  logger.warn(err);\n}\n' },
  { file: 'src/clean/query.ts', content: 'const q = "SELECT * FROM users WHERE id = ?";\n' },
];

/**
 * Generate the dataset. Deterministic for a given (size, seed).
 * Returns { root, cases, traps } — cases are the planted bugs, traps are
 * clean files + invalid refs the detectors must not anchor.
 */
export function generateDataset(root, { size = 40, seed = 42 } = {}) {
  const rand = rng(seed);
  const templateIds = Object.keys(TEMPLATES);
  const cases = [];
  const runId = `ds_${seed}_${randomUUID().slice(0, 6)}`;

  for (let i = 0; i < size; i++) {
    const id = templateIds[i % templateIds.length];
    const tpl = TEMPLATES[id];
    const dir = tpl.category === 'security' ? 'src/insecure' : 'src/bugs';
    const ext = id === 'py-eval-usage' ? 'py' : 'ts';
    const file = join(dir, `${id}_${i}.${ext}`);
    const variant = Math.floor(rand() * 10);
    const pad = Math.floor(rand() * 6); // padding shifts the bug line — location accuracy matters
    const { content, bugLine } = tpl.build(variant);
    const padded = Array.from({ length: pad }, (_, k) => `// pad ${k}`).concat(content.split('\n'));
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, file), padded.join('\n'), 'utf-8');
    cases.push({
      ref: `${file.split('\\').join('/')}:${pad + bugLine}`,
      detectorId: id,
      category: tpl.category,
      severity: tpl.severity,
      expect: 'anchored',
    });
  }

  for (const c of CLEAN_FILES) {
    mkdirSync(join(root, c.file, '..'), { recursive: true });
    writeFileSync(join(root, c.file), c.content, 'utf-8');
  }

  const traps = [
    ...CLEAN_FILES.map((c) => ({ ref: c.file, expect: 'no_finding', note: 'clean code must not fire' })),
    { ref: 'src/insecure/ghost.ts:4', expect: 'invalid', note: 'invented file' },
    { ref: 'src/bugs/eval-usage_0.ts:9999', expect: 'invalid', note: 'beyond EOF' },
  ];

  return { runId, root, cases, traps, size, seed, generatedAt: new Date().toISOString() };
}

/**
 * Arena Audit — Repository Intelligence (P1-01..P1-10)
 *
 * The engine must understand a repository WITHOUT any LLM:
 * file inventory, languages, package managers, git state, dependencies.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname, basename, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.turbo',
  '.cache', 'coverage', '.venv', 'venv', '__pycache__', '.gradle',
  'target', 'bin/obj', 'Pods', '.expo', '.arena', 'arena-audit-out',
]);

const GENERATED_HINTS = ['.min.js', '.bundle.js', 'lock.json', '.map', '.d.ts'];
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip',
  '.gz', '.tar', '.jar', '.apk', '.aab', '.ipa', '.exe', '.dll', '.so',
  '.dylib', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.mp3',
]);

/** P1-01 — File system indexer. Respects ignore rules and flags generated/binary files. */
export function indexFiles(root, { maxFiles = 20000, maxFileBytes = 2 * 1024 * 1024 } = {}) {
  const files = [];
  const directories = [];
  const ignored = [];

  function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        ignored.push(relative(root, join(dir, entry.name)));
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) { ignored.push(relative(root, full)); continue; }
        directories.push(relative(root, full).split(sep).join('/'));
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const rel = relative(root, full).split(sep).join('/');
        const ext = extname(entry.name).toLowerCase();
        const kind = BINARY_EXT.has(ext) ? 'binary'
          : GENERATED_HINTS.some((h) => rel.includes(h)) ? 'generated'
          : statSync(full).size > maxFileBytes ? 'huge'
          : 'source';
        files.push({ path: rel, ext, kind });
        if (files.length >= maxFiles) return;
      }
    }
  }

  walk(root, 0);
  return { files, directories, ignored, truncated: files.length >= maxFiles };
}

/** P1-02/P1-03 — Language & framework detection from file inventory + manifests. */
export function detectLanguages(root, index) {
  const counts = new Map();
  const EXT_LANG = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.go': 'Go',
    '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby',
    '.cs': 'C#', '.php': 'PHP', '.swift': 'Swift', '.dart': 'Dart',
    '.tf': 'Terraform', '.yml': 'YAML', '.yaml': 'YAML', '.sql': 'SQL',
  };
  for (const f of index.files) {
    const lang = EXT_LANG[f.ext];
    if (lang) counts.set(lang, (counts.get(lang) || 0) + 1);
  }
  const languages = [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);

  const frameworks = [];
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const FRAMEWORKS = {
        react: 'React', next: 'Next.js', vue: 'Vue', svelte: 'Svelte',
        expo: 'Expo', 'react-native': 'React Native', express: 'Express',
        fastify: 'Fastify', nestjs: 'NestJS', electron: 'Electron',
      };
      for (const [dep, label] of Object.entries(FRAMEWORKS)) {
        if (deps[dep]) frameworks.push(label);
      }
    } catch { /* malformed package.json is itself an audit signal, reported elsewhere */ }
  }
  if (existsSync(join(root, 'requirements.txt')) || existsSync(join(root, 'pyproject.toml'))) frameworks.push('Python (pip/poetry)');
  if (existsSync(join(root, 'go.mod'))) frameworks.push('Go modules');
  if (existsSync(join(root, 'Cargo.toml'))) frameworks.push('Cargo');
  if (existsSync(join(root, 'Dockerfile'))) frameworks.push('Docker');
  if (existsSync(join(root, 'docker-compose.yml'))) frameworks.push('Docker Compose');

  return { languages, frameworks: [...new Set(frameworks)] };
}

/** P1-04 — Package manager detection. */
export function detectPackageManager(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  if (existsSync(join(root, 'Cargo.lock'))) return 'cargo';
  if (existsSync(join(root, 'go.sum'))) return 'go';
  if (existsSync(join(root, 'poetry.lock'))) return 'poetry';
  if (existsSync(join(root, 'requirements.txt'))) return 'pip';
  if (existsSync(join(root, 'pom.xml')) || existsSync(join(root, 'build.gradle'))) return 'maven/gradle';
  return 'unknown';
}

/** P1-06 — Test inventory. */
export function inventoryTests(index) {
  return index.files
    .filter((f) => f.kind === 'source' &&
      (f.path.includes('.test.') || f.path.includes('.spec.') || /(^|\/)(tests?|__tests__)\//.test(f.path)))
    .map((f) => f.path);
}

/** P1-07 — CI inventory. */
export function inventoryCI(root) {
  const ci = [];
  const wfDir = join(root, '.github', 'workflows');
  if (existsSync(wfDir)) {
    try {
      for (const f of readdirSync(wfDir)) if (f.endsWith('.yml') || f.endsWith('.yaml')) ci.push(`github-actions/${f}`);
    } catch { /* unreadable workflow dir */ }
  }
  for (const f of ['.gitlab-ci.yml', 'Jenkinsfile', '.circleci/config.yml', '.drone.yml']) {
    if (existsSync(join(root, f))) ci.push(f);
  }
  return ci;
}

/** P1-08 — Git intelligence: HEAD, branch, dirty state, recent history. */
export function gitIntel(root) {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 15000 });
    return r.status === 0 ? (r.stdout || '').trim() : null;
  };
  const head = git(['rev-parse', 'HEAD']);
  if (!head) return { isGit: false };
  return {
    isGit: true,
    head,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: git(['status', '--porcelain']) !== '',
    commitSubject: git(['log', '-1', '--pretty=%s']),
    commitDate: git(['log', '-1', '--pretty=%cI']),
    remoteUrl: git(['remote', 'get-url', 'origin']),
  };
}

/** P1-09 — Dependency inventory (JS/TS ecosystem first). */
export function dependencyInventory(root) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return { ecosystem: detectPackageManager(root), direct: [], dev: [], count: 0 };
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const direct = Object.entries(pkg.dependencies || {}).map(([name, version]) => ({ name, version, kind: 'prod' }));
    const dev = Object.entries(pkg.devDependencies || {}).map(([name, version]) => ({ name, version, kind: 'dev' }));
    return {
      ecosystem: 'npm',
      projectName: pkg.name || basename(root),
      packageManager: detectPackageManager(root),
      direct,
      dev,
      count: direct.length + dev.length,
    };
  } catch {
    return { ecosystem: 'npm', direct: [], dev: [], count: 0, malformed: true };
  }
}

/** P1-10 — Full RepoSnapshot: the deterministic, LLM-free understanding of the repo. */
export function buildRepoSnapshot(root, existingIndex = null) {
  const index = existingIndex || indexFiles(root);
  const { languages, frameworks } = detectLanguages(root, index);
  const snapshot = {
    schemaVersion: 1,
    root: basename(root),
    fileCount: index.files.length,
    truncated: index.truncated,
    languages,
    frameworks,
    packageManager: detectPackageManager(root),
    tests: inventoryTests(index),
    ci: inventoryCI(root),
    git: gitIntel(root),
    dependencies: dependencyInventory(root),
    sampleSourceFiles: index.files.filter((f) => f.kind === 'source').slice(0, 200).map((f) => f.path),
    allFiles: index.files.map((f) => ({ path: f.path, kind: f.kind })),
  };
  return snapshot;
}

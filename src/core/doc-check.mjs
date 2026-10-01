/**
 * Arena Audit — Documentation Consistency Gate (P0-04..P0-07)
 *
 * Machine-checkable doc drift detection:
 *  1. package.json version appears in README.
 *  2. Every registry capability marked IMPLEMENTED has an existing evidence
 *     path and an existing test reference.
 *  3. docs/ARCHITECTURE.md and docs/FINAL_READINESS_REPORT.md exist.
 *  4. No capability is claimed READY/PRODUCTION-READY in the readiness report
 *     while its registry status is PLANNED.
 *
 * Exit 1 on any drift (CI-gateable: `npm run check-docs`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_REGISTRY } from './capability-status.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function checkDocumentation(root = resolve(__dirname, '..', '..')) {
  const problems = [];
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
  const version = pkg.version;

  // 1. Version consistency
  const readme = existsSync(resolve(root, 'README.md')) ? readFileSync(resolve(root, 'README.md'), 'utf-8') : '';
  if (!readme) problems.push('README.md missing');
  if (!readme.includes(version)) {
    problems.push(`README.md does not mention current package version ${version} (docs drift)`);
  }
  for (const doc of ['docs/ARCHITECTURE.md', 'docs/FINAL_READINESS_REPORT.md']) {
    if (!existsSync(resolve(root, doc))) problems.push(`${doc} missing`);
  }

  // 2. IMPLEMENTED capabilities must have existing evidence + tests
  for (const cap of CAPABILITY_REGISTRY) {
    if (cap.status === 'PLANNED' || cap.status === 'DEPRECATED') continue;
    if (cap.evidence) {
      const p = resolve(root, cap.evidence);
      if (!existsSync(p)) problems.push(`Capability '${cap.id}' evidence path does not exist: ${cap.evidence}`);
    } else if (cap.status === 'IMPLEMENTED') {
      problems.push(`Capability '${cap.id}' is IMPLEMENTED but has no evidence path`);
    }
    if (cap.tests) {
      for (const t of cap.tests.split(',').map((s) => s.trim())) {
        if (t === 'CI gate') continue;
        if (!existsSync(resolve(root, t))) problems.push(`Capability '${cap.id}' test reference does not exist: ${t}`);
      }
    }
  }

  // 3. Readiness report must not certify PLANNED capabilities
  const readinessPath = resolve(root, 'docs', 'FINAL_READINESS_REPORT.md');
  if (existsSync(readinessPath)) {
    const readiness = readFileSync(readinessPath, 'utf-8');
    for (const cap of CAPABILITY_REGISTRY) {
      if (cap.status !== 'PLANNED') continue;
      // crude but effective: PLANNED capability id must not appear as a READY row
      const rowRe = new RegExp(`\\|\\s*${cap.id.replace(/[-]/g, '\\-')}\\s*\\|[^|]*\\|[^|]*\\|[^|]*READY`);
      if (rowRe.test(readiness)) {
        problems.push(`Readiness report certifies PLANNED capability '${cap.id}' as READY`);
      }
    }
  }

  return { ok: problems.length === 0, problems, version };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1] && process.argv[1].endsWith('doc-check.mjs')) {
  const res = checkDocumentation();
  console.log(`Documentation consistency check (v${res.version})`);
  if (res.ok) {
    console.log('✓ README / registry / evidence paths / tests are consistent.');
  } else {
    console.log('✗ Documentation drift detected:');
    for (const p of res.problems) console.log(`  - ${p}`);
    process.exit(1);
  }
}

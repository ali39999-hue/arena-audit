/**
 * Test runner wrapper: resolves test files explicitly so behavior is
 * identical across Node versions (glob support in node --test varies).
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const unitDir = 'tests/unit';
const files = readdirSync(unitDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => join(unitDir, f));

const args = ['--test', '--test-timeout=15000', ...files];
if (process.env.FORCE_EXIT === '1') args.splice(1, 0, '--test-force-exit');

const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);

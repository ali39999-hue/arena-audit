import { execSync } from 'node:child_process';
const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }); } catch (e) { return e.stdout || e.message; } };
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, true, ms);

for (let i = 0; i < 30; i++) {
  const list = run('gh run list --repo ali39999-hue/arena-audit --workflow CI --limit 1 --json status,conclusion');
  let rows = [];
  try { rows = JSON.parse(list); } catch { sleepMs(15000); continue; }
  const ci = rows[0];
  console.log(`[${i}] CI: ${ci?.status}/${ci?.conclusion}`);
  if (ci?.status === 'completed') {
    if (ci.conclusion === 'success') { console.log('CI GREEN'); process.exit(0); }
    console.log('CI RED');
    process.exit(1);
  }
  sleepMs(15000);
}
console.log('POLL LIMIT');
process.exit(2);

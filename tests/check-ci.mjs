import { execSync } from 'node:child_process';
// Poll CI until the latest run completes (max ~5 min), then report.
const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }); } catch (e) { return e.stdout || e.message; } };

for (let i = 0; i < 20; i++) {
  const list = run('gh run list --repo ali39999-hue/arena-audit --limit 2');
  const lines = list.split('\n').filter(Boolean);
  const latest = lines[0] || '';
  console.log(`[${i}] ${latest.slice(0, 110)}`);
  const inProgress = /in_progress|queued|pending/.test(lines.map(l => l.slice(0, 12)).join('|'));
  if (!inProgress && lines.length >= 2) {
    // also show the second workflow
    console.log(lines[1].slice(0, 110));
    break;
  }
  setTimeout(() => {}, 0);
  // blocking sleep
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, true, 15000);
}

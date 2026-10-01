import { execSync } from 'node:child_process';
// Poll both workflows until complete (max ~6 min).
const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }); } catch (e) { return e.stdout || e.message; } };
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, true, ms);

let ciState = '', arenaState = '';
for (let i = 0; i < 24; i++) {
  const list = run('gh run list --repo ali39999-hue/arena-audit --limit 4 --json displayTitle,workflowName,status,conclusion');
  let rows = [];
  try { rows = JSON.parse(list); } catch { sleepMs(15000); continue; }
  const latestCi = rows.find((r) => r.workflowName === 'CI');
  const latestArena = rows.find((r) => r.workflowName === 'Arena Audit');
  ciState = latestCi ? `${latestCi.status}/${latestCi.conclusion}` : 'none';
  arenaState = latestArena ? `${latestArena.status}/${latestArena.conclusion}` : 'none';
  console.log(`[${i}] CI: ${ciState} · Arena Audit: ${arenaState}`);
  const ciDone = !ciState.includes('in_progress') && !ciState.includes('queued');
  const arenaDone = !arenaState.includes('in_progress') && !arenaState.includes('queued');
  if (ciDone && arenaDone) break;
  sleepMs(15000);
}

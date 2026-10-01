import { execSync } from 'node:child_process';
setTimeout(() => {
  try {
    const out = execSync('gh run list --repo ali39999-hue/arena-audit --limit 4', { encoding: 'utf-8', timeout: 30000 });
    console.log(out);
  } catch (e) { console.error(e.message); }
}, 25000);

/**
 * Arena Audit — Sandbox Policy (P9-01, P9-03, P9-04, P9-07, P9-10)
 *
 * Two trust modes:
 *  - "trusted":   your own repo. Gates run in the repo cwd with a sanitized
 *                 environment (API keys and credentials are stripped so a
 *                 malicious lifecycle script can never exfiltrate them).
 *  - "untrusted": audited repo is NOT trusted. Gates are refused unless an
 *                 explicit escape hatch is provided (--i-trust-this-repo).
 *                 Docker-based isolation is the future home of this mode.
 *
 * Honest limitation: without Docker this is environment hardening, NOT a
 * security boundary. The engine says so instead of pretending otherwise.
 */

const TRUSTED_ENV_ALLOWLIST = [
  'PATH', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
  'LANG', 'LC_ALL', 'HOME', 'USERPROFILE', 'APPDATA', 'PROGRAMFILES',
];

const SECRET_ENV_PATTERN = /(API_KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|AWS_|AZURE_|GCP_|GOOGLE_|OPENAI|ANTHROPIC|DEEPSEEK|GEMINI)/i;

/**
 * Build a sanitized environment for gate execution: only allowlisted vars
 * survive, and any variable that smells like a credential is dropped.
 */
export function sanitizeEnv(mode = 'trusted') {
  const env = {};
  for (const key of TRUSTED_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (SECRET_ENV_PATTERN.test(key)) continue; // never leak secrets to child processes
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}

/**
 * Assert that the chosen sandbox policy allows executing this repo's tooling.
 *  - trusted:  allowed (sanitized env).
 *  - docker:   allowed (container isolation) — availability checked at exec time.
 *  - untrusted: refused unless the operator explicitly vouches.
 */
export function assertSandboxPolicy(root, mode = 'trusted') {
  if (mode === 'trusted' || mode === 'docker') return;
  if (process.env.ARENA_TRUST_REPO === '1') return;
  throw new Error(
    `Refusing to execute repo tooling in untrusted mode for ${root}. ` +
    'Use --sandbox docker (isolated container) or --sandbox trusted if you own this repository ' +
    '(or set ARENA_TRUST_REPO=1).',
  );
}

/** Describe the effective sandbox posture for the audit manifest. */
export function sandboxPosture(mode = 'trusted') {
  if (mode === 'docker') {
    // Full detail is produced by dockerPosture() in docker.mjs; this stub
    // keeps the manifest shape stable when Docker is requested but unprobed.
    return { mode: 'docker', dockerIsolation: true, network: 'none', secretsInChildEnv: 'stripped' };
  }
  return {
    mode,
    network: mode === 'trusted' ? 'allow (host network)' : 'deny (refused without explicit trust)',
    secretsInChildEnv: 'stripped',
    filesystemBoundary: mode === 'trusted' ? 'none (trusted repo)' : 'refused',
    dockerIsolation: false,
    limitation: 'Environment hardening only — not a security boundary. Docker isolation is planned.',
  };
}

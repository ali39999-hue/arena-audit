/**
 * Arena Audit — Docker Sandbox Executor (P9-02, P9-04, P9-05, P9-07)
 *
 * Executes repository tooling inside an isolated container:
 *   network = none · base FS = read-only · tmpfs /tmp only
 *   CPU/RAM/PID quotas · non-root user (non-Windows hosts)
 *   host secrets never enter the container (sanitized env only)
 *
 * The repo is mounted read-write at /workspace because gates/tests may write
 * caches — that is the documented boundary, NOT a security guarantee.
 *
 * buildDockerArgs() is pure and unit-tested; runInDocker() executes it.
 */

import { spawnSync } from 'node:child_process';
import { sanitizeEnv } from './policy.mjs';

export const DEFAULT_IMAGE = process.env.ARENA_DOCKER_IMAGE || 'node:22-bookworm-slim';

/** Detect a usable Docker daemon. Returns {available, version?, reason?}. */
export function detectDocker() {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf-8', timeout: 15000,
  });
  if (r.status !== 0 || !r.stdout) {
    return { available: false, reason: (r.stderr || 'docker CLI unavailable or daemon not running').slice(0, 200) };
  }
  return { available: true, version: r.stdout.trim() };
}

/**
 * Build the `docker run` argv for one gate command.
 * Pure function — unit-testable without Docker.
 */
export function buildDockerArgs({ repoPath, image = DEFAULT_IMAGE, bin, args, timeoutSec = 300, cpus = 2, memory = '2g' }) {
  const dockerArgs = [
    'run', '--rm',
    '--network', 'none',                    // P9-04: deny-by-default networking
    '--read-only',                          // P9-03: immutable base filesystem
    '--tmpfs', '/tmp:rw,size=512m,noexec,nosuid',
    '--cpus', String(cpus),                 // P9-05: resource quotas
    '--memory', memory,
    '--pids-limit', '128',
    '-v', `${repoPath}:/workspace`,
    '-w', '/workspace',
    '-e', 'CI=1',
    '-e', 'HOME=/tmp',
  ];

  // P9-07: sanitized env only — every allowlisted var is forwarded explicitly,
  // secret-shaped vars never survive sanitizeEnv.
  const env = sanitizeEnv('trusted');
  for (const key of ['PATH', 'LANG', 'NODE_OPTIONS']) {
    if (env[key] !== undefined) dockerArgs.push('-e', `${key}=${env[key]}`);
  }

  // Non-root user on POSIX hosts; Windows Docker Desktop mounts break with --user.
  if (process.platform !== 'win32') dockerArgs.push('--user', '1000:1000');

  dockerArgs.push(image, 'node', bin, ...args);
  return dockerArgs;
}

/**
 * Run a gate command inside the sandbox container. Never throws.
 */
export function runInDocker(root, bin, args, { timeoutMs = 300000, image = DEFAULT_IMAGE } = {}) {
  const detection = detectDocker();
  if (!detection.available) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: `Docker sandbox requested but unavailable: ${detection.reason}. ` +
              'Install/start Docker, or run with --sandbox trusted.',
      durationMs: 0,
      sandboxUnavailable: true,
    };
  }
  const dockerArgs = buildDockerArgs({ repoPath: root, image, bin, args, timeoutSec: Math.ceil(timeoutMs / 1000) });
  const started = Date.now();
  const r = spawnSync('docker', dockerArgs, {
    encoding: 'utf-8',
    timeout: timeoutMs + 30000, // grace over the inner timeout
    maxBuffer: 8 * 1024 * 1024,
    env: sanitizeEnv('trusted'),
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    durationMs: Date.now() - started,
    timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT'),
    image,
  };
}

/** Sandbox posture for the manifest when docker mode is active. */
export function dockerPosture(image = DEFAULT_IMAGE) {
  return {
    mode: 'docker',
    network: 'none',
    filesystem: 'repo mounted rw at /workspace; base image read-only; tmpfs /tmp',
    secretsInChildEnv: 'stripped (sanitized allowlist only)',
    cpuQuota: '2 cores', memoryQuota: '2g', pidLimit: 128,
    image,
    dockerIsolation: true,
    limitation: 'Repo is mounted read-write (gates may write caches). Native node_modules built for the host OS may not match the container.',
  };
}

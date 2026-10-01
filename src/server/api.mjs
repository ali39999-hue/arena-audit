/**
 * Arena Audit — Control Plane API (P15-01, P15-06, P15-07)
 *
 * Pure request handler (unit-testable without sockets) + a thin node:http
 * wrapper. Security posture is explicit:
 *   - if ARENA_API_TOKEN is set → every non-health route requires Bearer auth
 *   - if not set → the server refuses to bind anything but loopback
 * Views and API never mix: findings lifecycle changes are explicit routes.
 */

import { createServer } from 'node:http';
import { FINDING_STATUSES } from '../core/schemas.mjs';

const RESOLUTIONS = ['fixed', 'reopened', 'regressed', 'accepted_risk', 'false_positive'];

export function handleRequest(store, { method, url, headers = {}, body = null }, opts = {}) {
  const token = opts.token || null;
  const u = new URL(url, 'http://localhost');
  const path = u.pathname.replace(/\/$/, '') || '/';
  const seg = path.split('/').filter(Boolean); // e.g. ['api','projects','prj_x','runs']
  const auth = token
    ? (headers.authorization === `Bearer ${token}`)
    : true; // loopback-only servers run without token

  const json = (status, body_) => ({ status, body: body_ });

  if (path === '/api/health') return json(200, { ok: true, service: 'arena-control-plane' });
  if (!auth) return json(401, { error: 'unauthorized' });
  if (seg[0] !== 'api') return json(404, { error: 'not found' });

  // ── POST /api/ingest — one-call push from the CLI ──
  if (method === 'POST' && path === '/api/ingest') {
    const { project, audit } = body || {};
    if (!project?.name || !audit?.run) return json(400, { error: 'project.name and audit.run are required' });
    const prj = store.upsertProject({ name: project.name, repository: project.repository || null });
    audit.projectId = prj.id;
    const { runId, created } = store.insertRun(audit);
    const ingested = store.upsertFindings(runId, audit.findings || []);
    return json(201, { runId, created, findingsIngested: ingested, projectId: prj.id });
  }

  // ── Projects ──
  if (method === 'POST' && path === '/api/projects') {
    if (!body?.name) return json(400, { error: 'name is required' });
    return json(201, store.upsertProject(body));
  }
  if (method === 'GET' && path === '/api/projects') return json(200, store.listProjects());
  if (seg[1] === 'projects' && seg[2] && !seg[3] && method === 'GET') {
    const prj = store.getProject(seg[2]);
    if (!prj) return json(404, { error: 'project not found' });
    return json(200, { ...prj, runs: store.listRuns(prj.id), trends: store.trends(prj.id) });
  }
  if (seg[1] === 'projects' && seg[2] && seg[3] === 'runs' && method === 'GET') {
    return json(200, store.listRuns(seg[2]));
  }
  if (seg[1] === 'projects' && seg[2] && seg[3] === 'trends' && method === 'GET') {
    return json(200, store.trends(seg[2]));
  }

  // ── Runs ──
  if (seg[1] === 'runs' && seg[2] && method === 'GET') {
    const run = store.getRun(seg[2]);
    if (!run) return json(404, { error: 'run not found' });
    return json(200, run);
  }

  // ── Findings ──
  if (path === '/api/findings' && method === 'GET') {
    return json(200, store.queryFindings({
      projectId: u.searchParams.get('projectId'),
      status: u.searchParams.get('status'),
      severity: u.searchParams.get('severity'),
      baselineState: u.searchParams.get('baselineState'),
    }));
  }
  if (seg[1] === 'findings' && seg[2] && seg[3] === 'resolve' && method === 'POST') {
    if (!RESOLUTIONS.includes(body?.resolution)) {
      return json(400, { error: `resolution must be one of ${RESOLUTIONS.join('|')}` });
    }
    const f = store.resolveFinding(seg[2], body.resolution, body.note || null);
    if (!f) return json(404, { error: 'finding not found' });
    return json(200, f);
  }
  if (seg[1] === 'findings' && seg[2] && method === 'GET') {
    const f = store.getFinding(seg[2]);
    return f ? json(200, f) : json(404, { error: 'finding not found' });
  }

  return json(404, { error: 'not found' });
}

/**
 * Create the HTTP server. Binds loopback by default; binding a public host
 * without a token is refused (the honest security boundary).
 */
export function createControlPlane(store, { token = null, host = '127.0.0.1', port = 7788, dashboard = null } = {}) {
  if (!token && host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Refusing to bind a non-loopback host without ARENA_API_TOKEN — set a token or keep loopback.');
  }
  const server = createServer((req, res) => {
    // The dashboard is same-origin HTML; everything else is the JSON API.
    if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard') && dashboard) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(dashboard);
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = { __invalid: true }; }
      const out = handleRequest(store, { method: req.method, url: req.url, headers: req.headers, body }, { token });
      res.writeHead(out.status, { 'Content-Type': 'application/json', 'X-Arena-Engine': 'control-plane' });
      res.end(JSON.stringify(out.body));
    });
  });
  return new Promise((resolvePromise) => {
    server.listen(port, host, () => resolvePromise(server));
  });
}

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
import { COMPLIANCE_PROFILES, evaluatePolicy } from './compliance.mjs';

const RESOLUTIONS = ['fixed', 'reopened', 'regressed', 'accepted_risk', 'false_positive'];
const ROLE_RANK = { viewer: 1, triager: 2, admin: 3 };

export function handleRequest(store, { method, url, headers = {}, body = null }, opts = {}) {
  const token = opts.token || null;
  const u = new URL(url, 'http://localhost');
  const path = u.pathname.replace(/\/$/, '') || '/';
  const seg = path.split('/').filter(Boolean); // e.g. ['api','projects','prj_x','runs']

  // P16-lite: authenticate via token registry (bootstrap token = admin).
  // Security model: when the server runs WITHOUT a token it must be bound to
  // loopback (enforced in createControlPlane) — anonymous requests then act
  // as admin so the local CLI `--push` flow keeps working. With a token set,
  // the registry is the only way in and roles apply.
  const bearer = (headers.authorization || '').startsWith('Bearer ')
    ? headers.authorization.slice(7) : null;
  const actor = token
    ? store.authenticate(bearer, token)
    : (bearer
      ? (store.authenticate ? store.authenticate(bearer, null) : null)
      : { id: 'anonymous-loopback', role: 'admin' });
  const auth = Boolean(actor);
  const rank = actor ? ROLE_RANK[actor.role] || 0 : 0;
  const requireRole = (min) => rank >= ROLE_RANK[min];

  const json = (status, body_) => ({ status, body: body_ });

  if (path === '/api/health') return json(200, { ok: true, service: 'arena-control-plane' });
  if (!auth) return json(401, { error: 'unauthorized' });
  if (seg[0] !== 'api') return json(404, { error: 'not found' });

  // ── POST /api/ingest — one-call push from the CLI ──
  if (method === 'POST' && path === '/api/ingest') {
    if (!requireRole('triager')) return json(403, { error: 'requires triager role' });
    const { project, audit } = body || {};
    if (!project?.name || !audit?.run) return json(400, { error: 'project.name and audit.run are required' });
    const prj = store.upsertProject({ name: project.name, repository: project.repository || null });
    audit.projectId = prj.id;
    const { runId, created } = store.insertRun(audit);
    const ingested = store.upsertFindings(runId, audit.findings || []);
    store.audit(actor.id, 'ingest', runId);
    return json(201, { runId, created, findingsIngested: ingested, projectId: prj.id });
  }

  // ── Token management (admin only, P16-lite) ──
  if (path === '/api/tokens' && method === 'POST') {
    if (!requireRole('admin')) return json(403, { error: 'requires admin role' });
    try {
      const created = store.createToken(body || {});
      store.audit(actor.id, 'create-token', created.id);
      return json(201, created);
    } catch (e) {
      return json(400, { error: e.message });
    }
  }
  if (path === '/api/tokens' && method === 'GET') {
    if (!requireRole('admin')) return json(403, { error: 'requires admin role' });
    return json(200, store.listTokens());
  }
  if (seg[1] === 'tokens' && seg[2] && method === 'DELETE') {
    if (!requireRole('admin')) return json(403, { error: 'requires admin role' });
    const t = store.revokeToken(seg[2]);
    if (!t) return json(404, { error: 'token not found' });
    store.audit(actor.id, 'revoke-token', seg[2]);
    return json(200, t);
  }

  // ── Enterprise Compliance & Policies (STEP 7-4) ──
  if (path === '/api/compliance/profiles' && method === 'GET') {
    return json(200, COMPLIANCE_PROFILES);
  }
  if (path === '/api/policy/evaluate' && method === 'POST') {
    const { findings = [], gates = [], profileName = 'OWASP-Top10' } = body || {};
    const result = evaluatePolicy({ findings, gates, profileName });
    return json(200, result);
  }

  // ── Audit log (admin only, P16-10) ──
  if (path === '/api/auditlog' && method === 'GET') {
    if (!requireRole('admin')) return json(403, { error: 'requires admin role' });
    return json(200, store.getAuditLog());
  }

  // ── Projects ──
  if (method === 'POST' && path === '/api/projects') {
    if (!requireRole('triager')) return json(403, { error: 'requires triager role' });
    if (!body?.name) return json(400, { error: 'name is required' });
    store.audit(actor.id, 'create-project', body.name);
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
    if (!requireRole('triager')) return json(403, { error: 'requires triager role' });
    if (!RESOLUTIONS.includes(body?.resolution)) {
      return json(400, { error: `resolution must be one of ${RESOLUTIONS.join('|')}` });
    }
    const f = store.resolveFinding(seg[2], body.resolution, body.note || null);
    if (!f) return json(404, { error: 'finding not found' });
    store.audit(actor.id, `resolve:${body.resolution}`, seg[2]);
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

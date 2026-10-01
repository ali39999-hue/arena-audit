/**
 * Arena Audit — Control Plane Store (P15-02..P05)
 *
 * Repository-shaped persistence behind a narrow interface, so a SQL adapter
 * (node:sqlite now, PostgreSQL in production) can slot in without touching
 * the API layer. Default adapter: single JSON file (atomic-ish writes,
 * single process) — an honest, documented scope for a local control plane.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { schemaVersion: 1, projects: {}, runs: {}, findings: {}, tokens: {}, auditLog: [] };
    if (existsSync(filePath)) {
      try {
        this.data = { ...this.data, ...JSON.parse(readFileSync(filePath, 'utf-8')) };
      } catch {
        throw new Error(`Control plane store is corrupt: ${filePath}`);
      }
    }
    this.persist();
  }

  persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  upsertProject({ name, repository = null }) {
    const existing = Object.values(this.data.projects).find((p) => p.name === name);
    if (existing) {
      if (repository) existing.repository = repository;
      this.persist();
      return existing;
    }
    const project = { id: `prj_${randomUUID().slice(0, 8)}`, name, repository, createdAt: new Date().toISOString() };
    this.data.projects[project.id] = project;
    this.persist();
    return project;
  }

  getProject(id) { return this.data.projects[id] || null; }
  listProjects() {
    return Object.values(this.data.projects).map((p) => ({
      ...p,
      runCount: Object.values(this.data.runs).filter((r) => r.projectId === p.id).length,
    }));
  }

  // ── Runs (P15-05) ─────────────────────────────────────────────────────────

  insertRun(audit) {
    const runId = audit.run?.runId || `run_${randomUUID().slice(0, 8)}`;
    if (this.data.runs[runId]) return { runId, created: false }; // idempotent ingest
    this.data.runs[runId] = {
      runId,
      projectId: audit.projectId,
      repository: audit.run?.repository || null,
      commit: audit.run?.commit || null,
      mode: audit.run?.mode || 'full',
      status: audit.run?.status || 'completed',
      engineVersion: audit.run?.engineVersion || null,
      provider: audit.run?.engine?.provider || null,
      model: audit.run?.engine?.model || null,
      overall: audit.scores?.overall ?? null,
      coveragePercent: audit.scores?.coverage?.percent ?? 0,
      verifiedCount: (audit.findings || []).filter((f) => f.status === 'verified').length,
      newCount: (audit.findings || []).filter((f) => f.baselineState === 'new').length,
      startedAt: audit.run?.startedAt || null,
      finishedAt: audit.run?.finishedAt || new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
    };
    this.persist();
    return { runId, created: true };
  }

  getRun(runId) { return this.data.runs[runId] || null; }
  listRuns(projectId) {
    return Object.values(this.data.runs)
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
  }

  /** P15-07 / P14-05: quality trend over runs. */
  trends(projectId) {
    return this.listRuns(projectId)
      .slice(0, 50)
      .reverse()
      .map((r) => ({
        runId: r.runId, finishedAt: r.finishedAt, mode: r.mode,
        overall: r.overall, coveragePercent: r.coveragePercent,
        verified: r.verifiedCount, new: r.newCount,
      }));
  }

  // ── Findings (P15-06) ─────────────────────────────────────────────────────

  upsertFindings(runId, findings) {
    let ingested = 0;
    for (const f of findings) {
      const id = f.fingerprint || f.id;
      const existing = this.data.findings[id];
      const record = {
        id,
        fingerprint: f.fingerprint || null,
        projectId: this.data.runs[runId]?.projectId || null,
        runIds: existing ? [...new Set([...(existing.runIds || []), runId])] : [runId],
        lens: f.lens || null,
        sources: f.sources || [f.lens].filter(Boolean),
        path: f.path || f.where || null,
        problem: f.problem || f.what || null,
        severity: f.severity || 'low',
        confidence: f.confidence ?? null,
        status: f.status || 'candidate',
        baselineState: f.baselineState || null,
        verifierNote: f.verifierNote || f.note || null,
        resolution: existing?.resolution || null,
        updatedAt: new Date().toISOString(),
      };
      this.data.findings[id] = record;
      ingested++;
    }
    this.persist();
    return ingested;
  }

  queryFindings({ projectId, status, severity, baselineState } = {}) {
    return Object.values(this.data.findings)
      .filter((f) => (!projectId || f.projectId === projectId)
        && (!status || f.status === status)
        && (!severity || f.severity === severity)
        && (!baselineState || f.baselineState === baselineState))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, 200);
  }

  getFinding(id) { return this.data.findings[id] || null; }

  /** P15-06: human triage — lifecycle transitions via the control plane. */
  resolveFinding(id, resolution, note = null) {
    const f = this.data.findings[id];
    if (!f) return null;
    f.status = resolution;
    if (note) f.resolution = { note, at: new Date().toISOString() };
    f.updatedAt = new Date().toISOString();
    this.persist();
    return f;
  }

  // ── P16-lite: token registry with roles + audit log ───────────────────────
  // Roles: admin (manage tokens + everything) > triager (resolve + ingest)
  //       > viewer (read-only). Bootstrap token (env) is always admin.
  // Raw tokens are shown once at creation; only sha256 hashes are stored.

  createToken({ name, role }) {
    if (!['admin', 'triager', 'viewer'].includes(role)) {
      throw new Error(`role must be admin|triager|viewer, got: ${role}`);
    }
    const raw = `arena_${randomUUID().replace(/-/g, '')}`;
    const id = `tok_${randomUUID().slice(0, 8)}`;
    this.data.tokens[id] = {
      id, name: name || id, role,
      tokenHash: createHash('sha256').update(raw, 'utf-8').digest('hex'),
      revoked: false,
      createdAt: new Date().toISOString(),
    };
    this.persist();
    return { id, name, role, raw }; // raw is returned exactly once
  }

  listTokens() {
    return Object.values(this.data.tokens).map(({ tokenHash, ...rest }) => rest);
  }

  revokeToken(id) {
    const t = this.data.tokens[id];
    if (!t) return null;
    t.revoked = true;
    t.revokedAt = new Date().toISOString();
    this.persist();
    return t;
  }

  /** Resolve a bearer token to {id, role} — bootstrap token is implicit admin. */
  authenticate(bearerToken, bootstrapToken = null) {
    if (!bearerToken) return null;
    if (bootstrapToken && bearerToken === bootstrapToken) return { id: 'bootstrap', role: 'admin' };
    const hash = createHash('sha256').update(bearerToken, 'utf-8').digest('hex');
    const t = Object.values(this.data.tokens).find((x) => x.tokenHash === hash && !x.revoked);
    return t ? { id: t.id, role: t.role } : null;
  }

  /** P16-10: who did what, when. */
  audit(actor, action, target) {
    this.data.auditLog.push({ actor, action, target, at: new Date().toISOString() });
    if (this.data.auditLog.length > 1000) this.data.auditLog = this.data.auditLog.slice(-1000);
    this.persist();
  }

  getAuditLog() { return [...this.data.auditLog].reverse(); }
}

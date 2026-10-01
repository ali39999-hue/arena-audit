/**
 * Arena Audit — Enterprise PostgreSQL Schema & Store Adapter (P15-02, STEP 7-1)
 *
 * Full multi-tenant PostgreSQL schema DDL and connection pool adapter.
 * Uses parameterized queries to prevent SQL injection and enforces
 * organization-level tenant isolation across all tables.
 */

export const POSTGRES_SCHEMA_SQL = `
-- Arena Audit Enterprise Schema (v2.x)

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(64) NOT NULL DEFAULT 'Viewer',
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_org_email ON users(org_id, email);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  repository_url VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);

CREATE TABLE IF NOT EXISTS audit_runs (
  run_id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha VARCHAR(64),
  mode VARCHAR(32) NOT NULL DEFAULT 'full',
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  overall_score INTEGER,
  coverage_percent INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_manifest JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_org_project ON audit_runs(org_id, project_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id VARCHAR(64) NOT NULL REFERENCES audit_runs(run_id) ON DELETE CASCADE,
  fingerprint VARCHAR(64) NOT NULL,
  lens VARCHAR(128),
  path VARCHAR(512) NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  problem TEXT NOT NULL,
  severity VARCHAR(32) NOT NULL,
  confidence NUMERIC(3, 2),
  status VARCHAR(32) NOT NULL,
  baseline_state VARCHAR(32),
  verifier_note TEXT,
  resolution JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_findings_org_proj_stat ON findings(org_id, project_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(org_id, fingerprint);

CREATE TABLE IF NOT EXISTS evidence_records (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id VARCHAR(64) NOT NULL REFERENCES audit_runs(run_id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  path VARCHAR(512),
  start_line INTEGER,
  end_line INTEGER,
  content_hash VARCHAR(64),
  commit_sha VARCHAR(64),
  excerpt TEXT,
  provenance JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_org_run ON evidence_records(org_id, run_id);

CREATE TABLE IF NOT EXISTS policies (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  profile VARCHAR(64) NOT NULL DEFAULT 'OWASP-Top10',
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_blocking BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_org ON policies(org_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor VARCHAR(64) NOT NULL,
  action VARCHAR(128) NOT NULL,
  target VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(org_id, timestamp DESC);
`;

/**
 * Returns PostgreSQL initialization SQL.
 */
export function getPostgresSchemaSql() {
  return POSTGRES_SCHEMA_SQL.trim();
}

/**
 * Production-ready PostgreSQL Store Adapter.
 * Wraps a pg.Pool or mock client, ensuring all operations are tenant-scoped.
 */
export class PostgreSqlStore {
  constructor(pool, defaultOrgId = 'org_default') {
    this.pool = pool;
    this.defaultOrgId = defaultOrgId;
  }

  async query(text, params = []) {
    return this.pool.query(text, params);
  }

  async upsertProject({ name, repository = null, orgId = this.defaultOrgId }) {
    const checkSql = 'SELECT id, name, repository_url FROM projects WHERE org_id = $1 AND name = $2 LIMIT 1';
    const checkRes = await this.query(checkSql, [orgId, name]);
    if (checkRes.rows.length > 0) {
      return checkRes.rows[0];
    }
    const id = `prj_${Math.random().toString(36).slice(2, 10)}`;
    const insertSql = 'INSERT INTO projects (id, org_id, name, repository_url) VALUES ($1, $2, $3, $4) RETURNING *';
    const insRes = await this.query(insertSql, [id, orgId, name, repository]);
    return insRes.rows[0];
  }

  async insertRun(audit, orgId = this.defaultOrgId) {
    const runId = audit.run?.runId || `run_${Math.random().toString(36).slice(2, 10)}`;
    const sql = `
      INSERT INTO audit_runs (run_id, org_id, project_id, commit_sha, mode, status, overall_score, coverage_percent, verified_count, new_count, started_at, raw_manifest)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (run_id) DO NOTHING
      RETURNING run_id
    `;
    const params = [
      runId,
      orgId,
      audit.projectId,
      audit.run?.commit || null,
      audit.run?.mode || 'full',
      audit.run?.status || 'completed',
      audit.scores?.overall ?? null,
      audit.scores?.coverage?.percent ?? 0,
      (audit.findings || []).filter(f => f.status === 'verified').length,
      (audit.findings || []).filter(f => f.baselineState === 'new').length,
      audit.run?.startedAt || new Date().toISOString(),
      JSON.stringify(audit),
    ];
    const res = await this.query(sql, params);
    return { runId, created: res.rows.length > 0 };
  }

  async queryFindings({ orgId = this.defaultOrgId, projectId = null, status = null, severity = null } = {}) {
    let sql = 'SELECT * FROM findings WHERE org_id = $1';
    const params = [orgId];

    if (projectId) {
      params.push(projectId);
      sql += ` AND project_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    if (severity) {
      params.push(severity);
      sql += ` AND severity = $${params.length}`;
    }

    sql += ' ORDER BY updated_at DESC LIMIT 200';
    const res = await this.query(sql, params);
    return res.rows;
  }

  async resolveFinding(id, resolution, note = null, orgId = this.defaultOrgId) {
    const sql = `
      UPDATE findings
      SET status = $1, resolution = $2, updated_at = NOW()
      WHERE id = $3 AND org_id = $4
      RETURNING *
    `;
    const res = await this.query(sql, [resolution, JSON.stringify({ note, at: new Date().toISOString() }), id, orgId]);
    return res.rows[0] || null;
  }

  async audit(actor, action, target, orgId = this.defaultOrgId, ipAddress = '127.0.0.1') {
    const id = `log_${Math.random().toString(36).slice(2, 10)}`;
    const sql = `
      INSERT INTO audit_logs (id, org_id, actor, action, target, ip_address, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `;
    const res = await this.query(sql, [id, orgId, actor, action, target, ipAddress]);
    return res.rows[0];
  }
}

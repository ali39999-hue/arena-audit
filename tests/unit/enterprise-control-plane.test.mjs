import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPostgresSchemaSql, PostgreSqlStore } from '../../src/server/postgres-schema.mjs';
import { hasPermission, satisfiesMfa, verifyOidcClaims, ENTERPRISE_ROLES } from '../../src/server/identity.mjs';
import { assertTenantBoundary, filterTenantRecords, TenantIsolationViolationError } from '../../src/server/multi-tenancy.mjs';
import { evaluatePolicy, COMPLIANCE_PROFILES } from '../../src/server/compliance.mjs';
import { SecretVault, redactSecrets, applyRetentionPolicy } from '../../src/server/retention.mjs';

// ── STEP 7-1: PostgreSQL Schema & Adapter ────────────────────────────────────

test('PostgreSQL DDL schema contains all enterprise multi-tenant tables', () => {
  const sql = getPostgresSchemaSql();
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS organizations'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS teams'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS users'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS projects'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS audit_runs'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS findings'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS evidence_records'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS policies'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS audit_logs'));
});

test('PostgreSqlStore queries correctly scope to tenant orgId', async () => {
  const executed = [];
  const mockPool = {
    query: async (text, params) => {
      executed.push({ text, params });
      if (text.includes('SELECT') && text.includes('projects')) {
        return { rows: [{ id: 'p1', name: 'demo', org_id: params[0] }] };
      }
      return { rows: [] };
    },
  };

  const store = new PostgreSqlStore(mockPool, 'org_enterprise_1');
  const prj = await store.upsertProject({ name: 'demo' });
  assert.equal(prj.id, 'p1');
  assert.equal(executed[0].params[0], 'org_enterprise_1');

  await store.queryFindings({ orgId: 'org_enterprise_1', severity: 'high' });
  assert.ok(executed[1].text.includes('org_id = $1'));
  assert.equal(executed[1].params[0], 'org_enterprise_1');
});

// ── STEP 7-2: Identity, RBAC & OIDC/SSO ──────────────────────────────────────

test('hasPermission enforces role hierarchy', () => {
  assert.equal(hasPermission('SuperAdmin', 'TENANT_MANAGE'), true);
  assert.equal(hasPermission('OrgAdmin', 'USERS_MANAGE'), true);
  assert.equal(hasPermission('SecurityLead', 'POLICIES_MANAGE'), true);
  assert.equal(hasPermission('Auditor', 'FINDINGS_TRIAGE'), true);
  assert.equal(hasPermission('Developer', 'FINDINGS_TRIAGE'), false);
  assert.equal(hasPermission('Viewer', 'AUDIT_RUN'), false);
  assert.equal(hasPermission('Viewer', 'AUDIT_READ'), true);
});

test('satisfiesMfa enforces MFA on admin and security lead roles', () => {
  assert.equal(satisfiesMfa('SuperAdmin', false), false);
  assert.equal(satisfiesMfa('SuperAdmin', true), true);
  assert.equal(satisfiesMfa('OrgAdmin', false), false);
  assert.equal(satisfiesMfa('SecurityLead', false), false);
  assert.equal(satisfiesMfa('Auditor', false), true); // auditor does not require MFA
  assert.equal(satisfiesMfa('Developer', false), true);
});

test('verifyOidcClaims validates tokens, expiration and maps SSO groups', () => {
  const now = Math.floor(Date.now() / 1000);
  const validClaims = {
    sub: 'usr_oidc_123',
    email: 'sec@company.com',
    name: 'Security Engineer',
    orgId: 'org_corp',
    groups: ['security-leads'],
    iss: 'https://auth.company.com',
    aud: 'arena-audit',
    exp: now + 3600,
    nbf: now - 10,
    amr: ['pwd', 'mfa'],
  };

  const res = verifyOidcClaims(validClaims, { expectedIssuer: 'https://auth.company.com', expectedAudience: 'arena-audit' });
  assert.equal(res.valid, true);
  assert.equal(res.user.role, 'SecurityLead');
  assert.equal(res.user.mfaAuthenticated, true);
  assert.equal(res.user.orgId, 'org_corp');

  // Expired token check
  const expiredClaims = { ...validClaims, exp: now - 100 };
  const resExp = verifyOidcClaims(expiredClaims);
  assert.equal(resExp.valid, false);
  assert.match(resExp.error, /expired/);
});

// ── STEP 7-3: Multi-Tenancy Isolation ────────────────────────────────────────

test('assertTenantBoundary strictly rejects cross-tenant interactions', () => {
  assert.doesNotThrow(() => assertTenantBoundary('org_A', 'org_A', 'evidence'));
  assert.throws(
    () => assertTenantBoundary('org_A', 'org_B', 'evidence'),
    TenantIsolationViolationError
  );
  assert.throws(
    () => assertTenantBoundary(null, 'org_B', 'project'),
    TenantIsolationViolationError
  );
});

test('filterTenantRecords only returns records matching orgId', () => {
  const records = [
    { id: '1', orgId: 'org_A', name: 'repo-A' },
    { id: '2', orgId: 'org_B', name: 'repo-B' },
    { id: '3', orgId: 'org_A', name: 'repo-A2' },
  ];
  const filtered = filterTenantRecords(records, 'org_A');
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every(r => r.orgId === 'org_A'));
});

// ── STEP 7-4: Policy-as-Code & Compliance ────────────────────────────────────

test('evaluatePolicy blocks runs with verified critical findings under OWASP-Top10', () => {
  const findings = [
    { path: 'src/auth.ts:10', severity: 'high', status: 'verified', problem: 'Auth Bypass' },
  ];
  const res = evaluatePolicy({ findings, profileName: 'OWASP-Top10' });
  assert.equal(res.compliant, false);
  assert.equal(res.action, 'BLOCK');
  assert.ok(res.violations.some(v => v.rule === 'critical_findings'));
});

test('evaluatePolicy allows compliant runs with no high findings', () => {
  const findings = [
    { path: 'src/style.ts:1', severity: 'low', status: 'verified', problem: 'Spacing' },
  ];
  const res = evaluatePolicy({ findings, profileName: 'OWASP-Top10' });
  assert.equal(res.compliant, true);
  assert.equal(res.action, 'ALLOW');
  assert.equal(res.violationsCount, 0);
});

test('FinTech-Strict compliance profile blocks on failing machine gates or unverified coverage', () => {
  const gates = [{ id: 'test', status: 'fail' }];
  const res = evaluatePolicy({ findings: [], gates, profileName: 'FinTech-Strict' });
  assert.equal(res.compliant, false);
  assert.equal(res.action, 'BLOCK');
  assert.ok(res.violations.some(v => v.rule === 'machine_gates_must_pass'));
});

// ── STEP 7-5: Secret Vault & Data Retention ──────────────────────────────────

test('SecretVault encrypts and decrypts with key rotation support', () => {
  const vault = new SecretVault();
  const secret = 'database-super-secret-password-1234';

  const encrypted1 = vault.encrypt(secret);
  assert.equal(encrypted1.version, 1);
  const decrypted1 = vault.decrypt(encrypted1);
  assert.equal(decrypted1, secret);

  // Key rotation
  const { newVersion } = vault.rotateKey();
  assert.equal(newVersion, 2);

  const encrypted2 = vault.encrypt('new-secret-999');
  assert.equal(encrypted2.version, 2);
  assert.equal(vault.decrypt(encrypted2), 'new-secret-999');

  // Old version 1 payload can still be decrypted using its versioned key
  assert.equal(vault.decrypt(encrypted1), secret);
});

test('applyRetentionPolicy filters records older than cutoff days', () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const records = [
    { id: 'recent', createdAt: new Date(now - 10 * dayMs).toISOString() },
    { id: 'old', createdAt: new Date(now - 120 * dayMs).toISOString() },
  ];

  const res = applyRetentionPolicy(records, { retentionDays: 90 });
  assert.equal(res.retainedCount, 1);
  assert.equal(res.expiredCount, 1);
  assert.equal(res.active[0].id, 'recent');
  assert.equal(res.expired[0].id, 'old');
});

/**
 * Arena Audit — Enterprise Identity, RBAC & OIDC/SSO (STEP 7-2)
 *
 * Full multi-level Role-Based Access Control and OIDC/SSO verification.
 * Roles: SuperAdmin > OrgAdmin > SecurityLead > Auditor > Developer > Viewer
 */

export const ENTERPRISE_ROLES = {
  SuperAdmin: {
    rank: 100,
    requiresMfa: true,
    permissions: [
      'AUDIT_RUN', 'AUDIT_READ', 'FINDINGS_TRIAGE',
      'POLICIES_MANAGE', 'SECRETS_MANAGE', 'USERS_MANAGE', 'AUDITLOG_VIEW', 'TENANT_MANAGE',
    ],
  },
  OrgAdmin: {
    rank: 80,
    requiresMfa: true,
    permissions: [
      'AUDIT_RUN', 'AUDIT_READ', 'FINDINGS_TRIAGE',
      'POLICIES_MANAGE', 'SECRETS_MANAGE', 'USERS_MANAGE', 'AUDITLOG_VIEW',
    ],
  },
  SecurityLead: {
    rank: 60,
    requiresMfa: true,
    permissions: [
      'AUDIT_RUN', 'AUDIT_READ', 'FINDINGS_TRIAGE',
      'POLICIES_MANAGE', 'AUDITLOG_VIEW',
    ],
  },
  Auditor: {
    rank: 40,
    requiresMfa: false,
    permissions: ['AUDIT_RUN', 'AUDIT_READ', 'FINDINGS_TRIAGE'],
  },
  Developer: {
    rank: 20,
    requiresMfa: false,
    permissions: ['AUDIT_RUN', 'AUDIT_READ'],
  },
  Viewer: {
    rank: 10,
    requiresMfa: false,
    permissions: ['AUDIT_READ'],
  },
};

/**
 * Check if a role possesses a specific permission.
 */
export function hasPermission(role, permission) {
  const roleDef = ENTERPRISE_ROLES[role];
  if (!roleDef) return false;
  return roleDef.permissions.includes(permission);
}

/**
 * Check if user session satisfies MFA requirements for their role.
 */
export function satisfiesMfa(role, isMfaAuthenticated) {
  const roleDef = ENTERPRISE_ROLES[role];
  if (!roleDef) return false;
  if (roleDef.requiresMfa && !isMfaAuthenticated) {
    return false;
  }
  return true;
}

/**
 * Verify OIDC / SSO token claims structure and validity.
 */
export function verifyOidcClaims(claims, { expectedAudience = null, expectedIssuer = null } = {}) {
  if (!claims || typeof claims !== 'object') {
    return { valid: false, error: 'Claims must be an object' };
  }

  const nowSec = Math.floor(Date.now() / 1000);

  if (claims.exp && claims.exp < nowSec) {
    return { valid: false, error: 'Token is expired' };
  }

  if (claims.nbf && claims.nbf > nowSec) {
    return { valid: false, error: 'Token is not yet active' };
  }

  if (expectedIssuer && claims.iss !== expectedIssuer) {
    return { valid: false, error: `Issuer mismatch: expected ${expectedIssuer}, got ${claims.iss}` };
  }

  if (expectedAudience && claims.aud !== expectedAudience) {
    return { valid: false, error: `Audience mismatch: expected ${expectedAudience}, got ${claims.aud}` };
  }

  if (!claims.sub || !claims.email) {
    return { valid: false, error: 'Token missing sub or email claims' };
  }

  // Map SSO group/role to Enterprise Role
  let role = 'Viewer';
  if (claims.role && ENTERPRISE_ROLES[claims.role]) {
    role = claims.role;
  } else if (Array.isArray(claims.groups)) {
    if (claims.groups.includes('arena-admins')) role = 'OrgAdmin';
    else if (claims.groups.includes('security-leads')) role = 'SecurityLead';
    else if (claims.groups.includes('auditors')) role = 'Auditor';
    else if (claims.groups.includes('developers')) role = 'Developer';
  }

  return {
    valid: true,
    user: {
      id: claims.sub,
      email: claims.email,
      name: claims.name || claims.email.split('@')[0],
      orgId: claims.orgId || claims['custom:org_id'] || 'org_default',
      role,
      mfaAuthenticated: Boolean(claims.amr && claims.amr.includes('mfa')),
    },
  };
}

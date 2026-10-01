/**
 * Arena Audit — Enterprise Multi-Tenancy Isolation Engine (STEP 7-3)
 *
 * Enforces strict cryptographic and logical boundaries between organizations.
 * Under NO circumstances can Organization A access or modify:
 *  - Evidence blobs or source code excerpts
 *  - Repositories or Projects
 *  - Audit runs or findings
 *  - Policies or Audit logs
 * of Organization B.
 */

export class TenantIsolationViolationError extends Error {
  constructor(message, userOrgId, targetOrgId, resourceType) {
    super(`Tenant Isolation Violation: ${message} (User Org: ${userOrgId}, Target Org: ${targetOrgId}, Resource: ${resourceType})`);
    this.name = 'TenantIsolationViolationError';
    this.userOrgId = userOrgId;
    this.targetOrgId = targetOrgId;
    this.resourceType = resourceType;
  }
}

/**
 * Validates that an active actor has permission to interact with target organization resource.
 */
export function assertTenantBoundary(actorOrgId, resourceOrgId, resourceType = 'resource') {
  if (!actorOrgId) {
    throw new TenantIsolationViolationError('Actor lacks organization context', 'none', resourceOrgId, resourceType);
  }
  if (!resourceOrgId) {
    throw new TenantIsolationViolationError('Target resource lacks organization binding', actorOrgId, 'none', resourceType);
  }
  if (actorOrgId !== resourceOrgId) {
    throw new TenantIsolationViolationError(
      `Cross-tenant access forbidden across organization boundaries`,
      actorOrgId,
      resourceOrgId,
      resourceType
    );
  }
  return true;
}

/**
 * Filter an array of records to guarantee only records matching the tenant orgId are returned.
 */
export function filterTenantRecords(records = [], orgId) {
  if (!orgId) return [];
  return records.filter(r => r && (r.orgId === orgId || r.org_id === orgId));
}

/**
 * Tenant-scoped query decorator for store implementations.
 */
export function scopeQueryToTenant(queryObj = {}, orgId) {
  if (!orgId) throw new Error('Cannot query without orgId context in multi-tenant mode');
  return {
    ...queryObj,
    orgId,
  };
}

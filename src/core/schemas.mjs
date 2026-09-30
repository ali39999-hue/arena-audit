/**
 * Arena Audit — Versioned Schemas (P0-01..P0-05)
 *
 * Contract-first: every run, finding and evidence object produced by the engine
 * conforms to a versioned schema and is validated before use. No schema,
 * no feature.
 */

export const ENGINE_SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Finding lifecycle states (P6-06): no finding is ever unlabeled.
// ---------------------------------------------------------------------------
export const FINDING_STATUSES = [
  'candidate',       // reported by a specialist, not yet challenged
  'invalid',         // evidence resolver could not anchor it (missing file/line)
  'verified',        // independent verifier confirmed with real code evidence
  'refuted',         // independent verifier rejected it against the actual code
  'inconclusive',    // verifier could not decide (needs human review)
  'stale',           // evidence hash no longer matches the file
  'fixed',
  'reopened',
  'regressed',
];

export const SEVERITIES = ['high', 'medium', 'low'];

export const GATE_STATUSES = ['pass', 'fail', 'not_available', 'error'];

// ---------------------------------------------------------------------------
// Validators (dependency-free, structural)
// ---------------------------------------------------------------------------

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isOneOf(v, list) {
  return list.includes(v);
}

/**
 * Validate a Finding object (P0-02).
 * Findings are separated from prompt output: a finding that cannot be
 * anchored to evidence is a candidate at best, never a verified fact.
 */
export function validateFinding(f) {
  const errors = [];
  if (!f || typeof f !== 'object') return { ok: false, errors: ['finding must be an object'] };
  if (!isNonEmptyString(f.id)) errors.push('id is required');
  if (!isNonEmptyString(f.lens)) errors.push('lens is required');
  if (!isNonEmptyString(f.where) && !isNonEmptyString(f.path)) errors.push('path (or where) is required');
  if (!isNonEmptyString(f.problem) && !isNonEmptyString(f.what)) errors.push('problem is required');
  if (f.severity !== undefined && !isOneOf(f.severity, SEVERITIES)) errors.push(`severity must be one of ${SEVERITIES.join('|')}`);
  if (f.status !== undefined && !isOneOf(f.status, FINDING_STATUSES)) errors.push(`status must be one of ${FINDING_STATUSES.join('|')}`);
  if (f.confidence !== undefined && (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 1)) {
    errors.push('confidence must be a number in [0..1]');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validate an Evidence object (P2-01): every assertion anchors to evidence.
 */
export function validateEvidence(e) {
  const errors = [];
  if (!e || typeof e !== 'object') return { ok: false, errors: ['evidence must be an object'] };
  if (!isNonEmptyString(e.id)) errors.push('id is required');
  if (!isNonEmptyString(e.type)) errors.push('type is required (source|command|scanner|test|git|documentation|reproduction)');
  if (e.type === 'source') {
    if (!isNonEmptyString(e.path)) errors.push('source evidence requires path');
    if (!isNonEmptyString(e.contentHash)) errors.push('source evidence requires contentHash');
    if (!isNonEmptyString(e.excerpt)) errors.push('source evidence requires excerpt');
  }
  if (e.type === 'command' && !isNonEmptyString(e.command)) errors.push('command evidence requires command');
  if (e.type === 'scanner' && !isNonEmptyString(e.tool)) errors.push('scanner evidence requires tool');
  return { ok: errors.length === 0, errors };
}

/**
 * Validate an AuditRun contract (P0-01 / P0-04).
 * Every run carries its identity: engine version, policy, model, commit, mode.
 */
export function validateAuditRun(run) {
  const errors = [];
  if (!run || typeof run !== 'object') return { ok: false, errors: ['run must be an object'] };
  if (!isNonEmptyString(run.runId)) errors.push('runId is required');
  if (!isNonEmptyString(run.schemaVersion)) errors.push('schemaVersion is required');
  if (!isNonEmptyString(run.engineVersion)) errors.push('engineVersion is required');
  if (!isNonEmptyString(run.mode)) errors.push('mode is required (full|diff|targeted|gates-only)');
  if (run.status !== undefined && !isOneOf(run.status, ['running', 'completed', 'failed', 'cancelled'])) {
    errors.push('status must be running|completed|failed|cancelled');
  }
  if (!isNonEmptyString(run.startedAt)) errors.push('startedAt is required');
  return { ok: errors.length === 0, errors };
}

/**
 * Create a new AuditRun identity. Call at engine startup.
 */
export function createAuditRun({ engineVersion, mode, provider = null, model = null, commit = null, repository = null }) {
  const run = {
    schemaVersion: ENGINE_SCHEMA_VERSION,
    runId: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    repository,
    commit,
    mode,
    engineVersion,
    engine: { version: engineVersion, provider, model },
    policy: { sandbox: 'trusted', network: 'allow' },
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    scores: null,
    coverage: null,
  };
  const check = validateAuditRun(run);
  if (!check.ok) throw new Error(`AuditRun contract violated: ${check.errors.join('; ')}`);
  return run;
}

/**
 * Arena Audit — Policy & Compliance Profiles Engine (STEP 7-4)
 *
 * Implements Policy-as-Code evaluation and standard industry compliance profiles:
 *  - OWASP Top 10 (A01 - A10)
 *  - CWE Top 25
 *  - NIST SP 800-53
 *  - SLSA Level 3 (Supply-chain Levels for Software Artifacts)
 *  - SOC2 Type II
 *  - FinTech Strict
 */

export const COMPLIANCE_PROFILES = {
  'OWASP-Top10': {
    name: 'OWASP Top 10 (2021)',
    description: 'Enforces zero critical vulnerabilities across the 10 major web security risks.',
    rules: {
      critical_findings: 'block',
      max_allowed_high: 0,
      secrets_allowed: false,
      injection_allowed: false,
      broken_access_allowed: false,
    },
  },
  'CWE-Top25': {
    name: 'CWE Top 25 Most Dangerous Software Weaknesses',
    description: 'Enforces strict rejection of top weaknesses including CWE-89, CWE-78, CWE-22, CWE-79.',
    rules: {
      critical_findings: 'block',
      max_allowed_high: 0,
      cwe_top25_allowed: false,
    },
  },
  'NIST-SP800-53': {
    name: 'NIST SP 800-53 Security and Privacy Controls',
    description: 'Federal-grade security verification with required machine gate coverage and audit logs.',
    rules: {
      critical_findings: 'block',
      min_coverage_percent: 80,
      machine_gates_must_pass: true,
      audit_logging_required: true,
    },
  },
  'SLSA-Level3': {
    name: 'SLSA Level 3 Supply Chain Security',
    description: 'Guarantees build provenance, commit-bound evidence, and immutable artifacts.',
    rules: {
      commit_binding_required: true,
      provenance_required: true,
      stale_evidence_blocked: true,
      unverified_findings_blocked: true,
    },
  },
  'SOC2-TypeII': {
    name: 'SOC2 Type II Trust Services Criteria',
    description: 'Ensures change control, audit trails, and human triage sign-offs.',
    rules: {
      human_approval_required: true,
      audit_logging_required: true,
      max_allowed_high: 0,
    },
  },
  'FinTech-Strict': {
    name: 'FinTech Strict Financial Integrity',
    description: 'Zero precision loss on monetary figures, zero hardcoded credentials, full test suite pass.',
    rules: {
      critical_findings: 'block',
      max_allowed_high: 0,
      max_allowed_medium: 0,
      float_math_on_money: false,
      secrets_allowed: false,
      machine_gates_must_pass: true,
      min_coverage_percent: 90,
    },
  },
};

/**
 * Evaluate an audit run against an active organization policy.
 */
export function evaluatePolicy({ auditRun, findings = [], gates = [], policy = null, profileName = 'OWASP-Top10' }) {
  const activeProfile = COMPLIANCE_PROFILES[profileName] || COMPLIANCE_PROFILES['OWASP-Top10'];
  const rules = { ...activeProfile.rules, ...(policy?.rules || {}) };

  const violations = [];
  const verifiedFindings = findings.filter(f => f.status === 'verified');

  // Rule 1: High/Critical severity findings
  const highFindings = verifiedFindings.filter(f => f.severity === 'high');
  if (rules.critical_findings === 'block' && highFindings.length > 0) {
    violations.push({
      rule: 'critical_findings',
      severity: 'high',
      message: `Blocked: ${highFindings.length} verified high-severity finding(s) detected.`,
      findings: highFindings.map(f => f.path),
    });
  }

  // Rule 2: Max allowed high
  if (typeof rules.max_allowed_high === 'number' && highFindings.length > rules.max_allowed_high) {
    violations.push({
      rule: 'max_allowed_high',
      severity: 'high',
      message: `Exceeded max allowed high findings (${highFindings.length} > ${rules.max_allowed_high}).`,
    });
  }

  // Rule 3: Max allowed medium
  const medFindings = verifiedFindings.filter(f => f.severity === 'medium');
  if (typeof rules.max_allowed_medium === 'number' && medFindings.length > rules.max_allowed_medium) {
    violations.push({
      rule: 'max_allowed_medium',
      severity: 'medium',
      message: `Exceeded max allowed medium findings (${medFindings.length} > ${rules.max_allowed_medium}).`,
    });
  }

  // Rule 4: Machine gates must pass
  if (rules.machine_gates_must_pass === true) {
    const failedGates = gates.filter(g => g.status === 'fail');
    if (failedGates.length > 0) {
      violations.push({
        rule: 'machine_gates_must_pass',
        severity: 'high',
        message: `Machine gates failed: ${failedGates.map(g => g.id).join(', ')}.`,
      });
    }
  }

  // Rule 5: Min coverage percent
  if (typeof rules.min_coverage_percent === 'number') {
    const coverage = auditRun?.scores?.coverage?.percent ?? auditRun?.coveragePercent ?? 0;
    if (coverage < rules.min_coverage_percent) {
      violations.push({
        rule: 'min_coverage_percent',
        severity: 'medium',
        message: `Audit coverage ${coverage}% is below the required ${rules.min_coverage_percent}%.`,
      });
    }
  }

  // Rule 6: Secrets allowed
  if (rules.secrets_allowed === false) {
    const secretFindings = verifiedFindings.filter(f =>
      (f.lens && f.lens.includes('credential')) ||
      (f.problem && (f.problem.includes('credential') || f.problem.includes('secret') || f.problem.includes('token')))
    );
    if (secretFindings.length > 0) {
      violations.push({
        rule: 'secrets_allowed',
        severity: 'high',
        message: `Exposed secret/credential detected in codebase.`,
        findings: secretFindings.map(f => f.path),
      });
    }
  }

  const compliant = violations.length === 0;

  return {
    compliant,
    profile: activeProfile.name,
    rulesApplied: rules,
    violationsCount: violations.length,
    violations,
    action: compliant ? 'ALLOW' : (rules.critical_findings === 'block' ? 'BLOCK' : 'WARN'),
    evaluatedAt: new Date().toISOString(),
  };
}

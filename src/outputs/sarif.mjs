/**
 * Arena Audit — SARIF 2.1.0 Exporter (P12-03, P12-08)
 *
 * Standard interchange for GitHub Advanced Security / GitLab / IDEs.
 * Refuted findings are included with their status property so downstream
 * consumers can filter — nothing is silently dropped.
 */

const LEVEL = { high: 'error', medium: 'warning', low: 'note' };

export function toSarif({ projectName, findings, gates }) {
  // SARIF requires unique rule ids — dedupe rules by id (fingerprints may repeat).
  const rulesById = new Map();
  const results = [];

  for (const f of findings) {
    const ruleId = `ARENA/${f.fingerprint || f.lens || 'finding'}`;
    if (!rulesById.has(ruleId)) {
      rulesById.set(ruleId, {
        id: ruleId,
        name: f.lens || 'audit-finding',
        shortDescription: { text: f.lens || 'Arena audit finding' },
        fullDescription: { text: f.problem || '' },
        defaultConfiguration: { level: LEVEL[f.severity] || 'note' },
        properties: {
          'arena/status': f.status,
          'arena/confidence': f.confidence ?? null,
          'arena/severity': f.severity,
        },
      });
    }

    const m = String(f.path || '').match(/^(.*?):(\d+)/);
    results.push({
      ruleId,
      level: LEVEL[f.severity] || 'note',
      message: {
        text: `[${f.status}] ${f.problem}${f.verifierNote ? ` — verifier: ${f.verifierNote}` : ''}`,
      },
      locations: m ? [{
        physicalLocation: {
          artifactLocation: { uri: m[1].replace(/\\/g, '/') },
          region: { startLine: parseInt(m[2], 10) || 1 },
        },
      }] : [],
      partialFingerprints: { arenaFingerprint: f.fingerprint || '' },
      properties: { status: f.status, confidence: f.confidence ?? null, sources: f.sources || [f.lens] },
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'arena-audit',
          informationUri: 'https://github.com/ali39999-hue/arena-audit',
          rules: [...rulesById.values()],
        },
      },
      automationDetails: { id: `arena-audit/${projectName || 'repo'}` },
      properties: {
        gates: Object.fromEntries((gates || []).map((g) => [g.id, g.status])),
      },
      results,
    }],
  };
}

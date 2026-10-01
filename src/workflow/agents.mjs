/**
 * Arena Audit — Agent Registry & Assignment (DW-04)
 *
 * Agents declare: capabilities, tools, provider, model, safetyClass,
 * concurrency and cost constraints. Dynamic agent selection matches a
 * capability to the best available agent with a fallback provider chain.
 */

export const AGENTS = [
  {
    id: 'planner',
    capabilities: ['repository-intelligence', 'semantic-analysis', 'machine-gates', 'self-audit'],
    tools: ['readFile', 'search', 'findSymbol', 'runGate', 'runDetector', 'inspectDependencies'],
    provider: 'none', model: 'none',
    safetyClass: 'read',
    maxConcurrency: 2,
    costConstraint: 0,
  },
  {
    id: 'security-specialist',
    capabilities: ['security-audit'],
    tools: ['readFile', 'search', 'findSymbol', 'runDetector'],
    provider: 'anthropic', model: 'claude-3-5-sonnet',
    safetyClass: 'read',
    maxConcurrency: 4,
    costConstraint: 0.01,
  },
  {
    id: 'correctness-specialist',
    capabilities: ['correctness-audit'],
    tools: ['readFile', 'search', 'findSymbol', 'runDetector'],
    provider: 'anthropic', model: 'claude-3-5-sonnet',
    safetyClass: 'read',
    maxConcurrency: 4,
    costConstraint: 0.01,
  },
  {
    id: 'architecture-specialist',
    capabilities: ['architecture-audit'],
    tools: ['readFile', 'search', 'findSymbol', 'inspectDependencies', 'runDetector'],
    provider: 'anthropic', model: 'claude-3-5-sonnet',
    safetyClass: 'read',
    maxConcurrency: 4,
    costConstraint: 0.01,
  },
  {
    id: 'testing-specialist',
    capabilities: ['testing-audit'],
    tools: ['readFile', 'search', 'runTest', 'runDetector'],
    provider: 'anthropic', model: 'claude-3-5-sonnet',
    safetyClass: 'read',
    maxConcurrency: 4,
    costConstraint: 0.01,
  },
  {
    id: 'performance-specialist',
    capabilities: ['performance-audit'],
    tools: ['readFile', 'search', 'findSymbol', 'runDetector'],
    provider: 'openai', model: 'gpt-4o',
    safetyClass: 'read',
    maxConcurrency: 4,
    costConstraint: 0.01,
  },
  {
    id: 'supply-chain-specialist',
    capabilities: ['supply-chain-audit'],
    tools: ['readFile', 'inspectDependencies', 'runDetector'],
    provider: 'openai', model: 'gpt-4o',
    safetyClass: 'read',
    maxConcurrency: 2,
    costConstraint: 0.01,
  },
  {
    id: 'verifier',
    capabilities: ['verification', 'evidence-analysis', 'regression'],
    tools: ['readFile', 'findSymbol', 'getCallers', 'rerunAudit'],
    provider: 'anthropic', model: 'claude-3-5-sonnet',
    safetyClass: 'read',
    maxConcurrency: 4,
    costConstraint: 0.02,
  },
  {
    id: 'reproducer',
    capabilities: ['reproduction'],
    tools: ['readFile', 'runTest', 'sandboxExecute'],
    provider: 'openai', model: 'gpt-4o',
    safetyClass: 'execute',
    maxConcurrency: 2,
    costConstraint: 0.01,
  },
  {
    id: 'remediator',
    capabilities: ['remediation'],
    tools: ['readFile', 'writePatch', 'applyCheck', 'runTest'],
    provider: 'anthropic', model: 'claude-3-5-sonnet',
    safetyClass: 'write',
    maxConcurrency: 1,
    costConstraint: 0.03,
  },
  {
    id: 'judge',
    capabilities: ['policy-evaluation', 'reporting'],
    tools: ['readFile'],
    provider: 'anthropic', model: 'claude-3-5-sonnet',
    safetyClass: 'read',
    maxConcurrency: 1,
    costConstraint: 0.01,
  },
];

export const FALLBACK_PROVIDER_CHAIN = ['anthropic', 'openai', 'deepseek', 'gemini', 'ollama', 'none'];

export class AgentRegistry {
  constructor(manifests = AGENTS) {
    this.map = new Map(manifests.map((a) => [a.id, { ...a, tools: [...a.tools], capabilities: [...a.capabilities] }]));
  }

  get(id) { return this.map.get(id) || null; }
  list() { return [...this.map.values()]; }

  /** Agents that can execute a capability. */
  agentsFor(capabilityId) {
    return this.list().filter((a) => a.capabilities.includes(capabilityId));
  }

  /**
   * Dynamic agent selection for a task: highest-rank match with an available
   * provider; falls back through FALLBACK_PROVIDER_CHAIN when the preferred
   * provider is unavailable.
   */
  selectAgent(capabilityId, { availableProviders = null, preferredProvider = null } = {}) {
    const candidates = this.agentsFor(capabilityId);
    if (candidates.length === 0) return null;

    const chain = preferredProvider
      ? [preferredProvider, ...FALLBACK_PROVIDER_CHAIN]
      : FALLBACK_PROVIDER_CHAIN;

    for (const provider of chain) {
      const agent = candidates.find((a) => a.provider === provider);
      if (agent && (!availableProviders || availableProviders.includes(provider))) {
        return agent;
      }
    }
    // Last resort: first candidate regardless of provider availability
    return candidates[0];
  }
}

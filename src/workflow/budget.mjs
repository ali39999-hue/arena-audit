/**
 * Arena Audit — Budget Engine (DW-13)
 *
 * Tracks: maxTasks, maxConcurrency, maxRuntimeMs, maxTokens, maxLLMCost,
 * maxRetries, maxArtifacts.
 * Soft threshold (default 80%) emits a warning; hard limit stops the run.
 */

export const SOFT_THRESHOLD = 0.8;

export class Budget {
  constructor(limits = {}) {
    this.limits = {
      maxTasks: null,
      maxConcurrency: null,
      maxRuntimeMs: null,
      maxTokens: null,
      maxLLMCost: null,
      maxRetries: null,
      maxArtifacts: null,
      ...limits,
    };
    this.usage = {
      tasksExecuted: 0,
      tokensUsed: 0,
      llmCostUsed: 0,
      retriesUsed: 0,
      artifactsCreated: 0,
    };
    this.startedAt = Date.now();
    this.softWarnings = [];
    this.exceeded = null; // { dimension, limit, used }
  }

  charge(kind, amount = 1) {
    if (kind in this.usage) this.usage[kind] += amount;
  }

  elapsedMs() {
    return Date.now() - this.startedAt;
  }

  /**
   * Check all limits. Returns { ok, exceeded?, softWarnings? }.
   */
  check() {
    const L = this.limits;
    const U = this.usage;

    const checks = [
      ['maxTasks', U.tasksExecuted],
      ['maxTokens', U.tokensUsed],
      ['maxLLMCost', U.llmCostUsed],
      ['maxRetries', U.retriesUsed],
      ['maxArtifacts', U.artifactsCreated],
      ['maxRuntimeMs', this.elapsedMs()],
    ];

    for (const [dim, used] of checks) {
      const limit = L[dim];
      if (limit == null) continue;
      if (used >= limit) {
        this.exceeded = { dimension: dim, limit, used };
        return { ok: false, exceeded: this.exceeded };
      }
      if (used >= limit * SOFT_THRESHOLD) {
        const warning = { dimension: dim, limit, used, at: new Date().toISOString() };
        if (!this.softWarnings.some((w) => w.dimension === dim)) {
          this.softWarnings.push(warning);
        }
      }
    }
    return { ok: true, softWarnings: this.softWarnings };
  }

  /** Concurrency is enforced by the scheduler; here we only validate the limit. */
  validateConcurrency(requested) {
    if (this.limits.maxConcurrency != null && requested > this.limits.maxConcurrency) {
      return this.limits.maxConcurrency;
    }
    return requested;
  }
}

/**
 * Arena Audit — Failure Classification & Recovery (DW-12)
 *
 * Failure classes: retryable, provider-failure, tool-failure, sandbox-failure,
 * timeout, budget-exceeded, policy-denied, malformed-result, stale-artifact,
 * non-retryable.
 *
 * Recovery strategies: retry, fallback-agent, fallback-tool, replan, abort.
 */

export const FAILURE_CLASSES = {
  retryable: { retry: true },
  'provider-failure': { retry: true, fallback: 'fallback-provider' },
  'tool-failure': { retry: true, fallback: 'fallback-tool' },
  'sandbox-failure': { retry: false, fallback: 'replan' },
  timeout: { retry: true },
  'budget-exceeded': { retry: false, abort: true },
  'policy-denied': { retry: false, abort: true },
  'malformed-result': { retry: true, fallback: 'fallback-agent' },
  'stale-artifact': { retry: false, replan: true },
  'non-retryable': { retry: false, abort: true },
};

export function classifyFailure(error) {
  const message = String(error?.message || error || '');
  const code = error?.code || '';

  if (/timed out/i.test(message) || code === 'ETIMEDOUT') return 'timeout';
  if (/budget/i.test(message)) return 'budget-exceeded';
  if (/policy|permission|unauthorized|forbidden/i.test(message)) return 'policy-denied';
  if (/sandbox|docker/i.test(message)) return 'sandbox-failure';
  if (/provider|api error|rate limit|overloaded/i.test(message)) return 'provider-failure';
  if (/malformed|invalid json|could not parse/i.test(message)) return 'malformed-result';
  if (/stale/i.test(message)) return 'stale-artifact';
  if (/ENOENT|spawn|tool/i.test(message)) return 'tool-failure';
  if (/assert|typeerror|referenceerror|cannot read/i.test(message)) return 'non-retryable';
  return 'retryable';
}

export function recoveryStrategyFor(failureClass) {
  return FAILURE_CLASSES[failureClass] || { retry: false, abort: true };
}

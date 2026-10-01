// AMBIGUOUS FINDING: Timeout vs latency tradeoff
// A short timeout fails fast in peak load but might prematurely drop slow requests.
// A long timeout survives slow third-parties but holds connections.
// This is not an objective bug; it requires human business/policy clarification.
export const HTTP_CLIENT_CONFIG = {
  timeoutMs: 8000,
  maxRetries: 2,
  backoffMultiplier: 1.5,
};

export function shouldRetry(attempt: number, errorStatus: number): boolean {
  if (attempt >= HTTP_CLIENT_CONFIG.maxRetries) return false;
  return errorStatus >= 500;
}

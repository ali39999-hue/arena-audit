/**
 * Arena Audit — Bounded Concurrency Pool (P5-04 / P5-05)
 *
 * True parallelism with a worker-pool model. Never an unbounded Promise.all.
 * One failed item costs one item — never the whole audit.
 */

/**
 * Run `worker(item, index)` over `items` with at most `maxConcurrency`
 * in-flight promises. Preserves input order in results.
 *
 * @param {Array} items
 * @param {(item: any, index: number) => Promise<any>} worker
 * @param {{ maxConcurrency?: number, onSettled?: (r: {index:number, ok:boolean, value?:any, error?:Error}) => void }} opts
 * @returns {Promise<Array<{ok: boolean, value?: any, error?: Error}>>}
 */
export async function runPool(items, worker, { maxConcurrency = 4, onSettled } = {}) {
  const n = Math.max(1, Math.min(maxConcurrency, 64));
  const results = new Array(items.length);
  let next = 0;

  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { ok: true, value };
        if (onSettled) onSettled({ index: i, ok: true, value });
      } catch (error) {
        results[i] = { ok: false, error };
        if (onSettled) onSettled({ index: i, ok: false, error });
      }
    }
  }

  const lanes = [];
  const laneCount = Math.min(n, items.length);
  for (let i = 0; i < laneCount; i++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}

/**
 * Race a task against a hard timeout. Rejects with a timeout Error.
 */
export function withTimeout(promiseFactory, timeoutMs, label = 'task') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(promiseFactory), timeout]).finally(() => clearTimeout(timer));
}

/** Structured error taxonomy (X-01). */
export const ErrorKind = {
  CONFIG: 'config',
  PROVIDER: 'provider',
  EVIDENCE: 'evidence',
  GATE: 'gate',
  SANDBOX: 'sandbox',
  TIMEOUT: 'timeout',
  INTERNAL: 'internal',
};

export class ArenaError extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.name = 'ArenaError';
    this.kind = kind;
    this.cause = cause;
  }
}

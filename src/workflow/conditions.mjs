/**
 * Arena Audit — Condition DSL (DW-10)
 *
 * Safe, declarative, data-only condition expressions.
 * NEVER executes arbitrary code (no eval / no new Function).
 *
 * Expression shape:
 *   { field: 'finding.severity', op: 'gte', value: 'high' }
 *   { all: [expr, expr] }  { any: [expr, expr] }  { not: expr }
 *
 * Supported ops over scalars/arrays:
 *   eq, ne, gte, lte, gt, lt, in, exists, matches
 */

const RANK = { low: 1, medium: 2, high: 3, critical: 4 };

function resolveField(context, path) {
  const parts = String(path).split('.');
  let cur = context;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function applyOp(op, actual, expected) {
  switch (op) {
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'gt': return compare(actual, expected) > 0;
    case 'gte': return compare(actual, expected) >= 0;
    case 'lt': return compare(actual, expected) < 0;
    case 'lte': return compare(actual, expected) <= 0;
    case 'in': return Array.isArray(expected) ? expected.includes(actual) : false;
    case 'exists': return actual !== undefined && actual !== null;
    case 'matches': return typeof actual === 'string' && new RegExp(expected).test(actual);
    default: throw new Error(`Unknown condition op: ${op}`);
  }
}

/**
 * Severity words compare by rank; everything else uses natural comparison.
 */
function compare(a, b) {
  const ra = RANK[String(a).toLowerCase()];
  const rb = RANK[String(b).toLowerCase()];
  if (ra !== undefined && rb !== undefined) return ra - rb;
  const na = Number(a); const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

/**
 * Evaluate a condition expression against a context object.
 * Unknown fields evaluate to false for positive ops (fail-closed).
 */
export function evaluateCondition(expr, context) {
  if (expr == null) return true;
  if (typeof expr === 'boolean') return expr;

  if (expr.all) return expr.all.every((e) => evaluateCondition(e, context));
  if (expr.any) return expr.any.some((e) => evaluateCondition(e, context));
  if (expr.not) return !evaluateCondition(expr.not, context);

  if (!expr.field || !expr.op) {
    throw new Error('Condition expressions require { field, op, value } (or all/any/not)');
  }

  const actual = resolveField(context, expr.field);
  try {
    return applyOp(expr.op, actual, expr.value);
  } catch {
    return false; // fail-closed on comparison errors
  }
}

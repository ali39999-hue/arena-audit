/**
 * Arena Audit — Observability / Telemetry (P19-01, P19-02, P19-05, P19-06)
 *
 * A run is one trace. Every phase, gate and agent call is a span with a
 * trace id, duration, and outcome. Honest cost accounting: without provider
 * usage payloads we count CALLS and DURATIONS, not tokens — the record says
 * so instead of inventing numbers.
 */

import { randomUUID } from 'node:crypto';

export function createTelemetry(runId) {
  const events = [];
  const t0 = Date.now();

  function emit(kind, name, data = {}, parentSpanId = null, status = 'ok') {
    const ev = {
      traceId: runId,
      spanId: randomUUID().slice(0, 8),
      parentSpanId,
      kind, // phase | gate | agent | llm | error
      name,
      status,
      at: new Date().toISOString(),
      durationMs: null,
      data,
    };
    events.push(ev);
    return ev;
  }

  return {
    events,

    /** Start a span; call .end(status, data) when done. */
    start(kind, name, parentSpanId = null) {
      const ev = emit(kind, name, {}, parentSpanId, 'running');
      const startedAt = Date.now();
      return {
        spanId: ev.spanId,
        end(status = 'ok', data = {}) {
          ev.status = status;
          ev.durationMs = Date.now() - startedAt;
          Object.assign(ev.data, data);
          return ev;
        },
      };
    },

    /** One-off event with duration (e.g. a timed block that already finished). */
    timed(kind, name, durationMs, data = {}, parentSpanId = null) {
      const ev = emit(kind, name, data, parentSpanId);
      ev.durationMs = durationMs;
      return ev;
    },

    error(name, message, parentSpanId = null) {
      return emit('error', name, { message: String(message).slice(0, 500) }, parentSpanId, 'error');
    },

    /** Aggregate summary — the numbers P19-09 dashboards consume. */
    summary() {
      const byKind = {};
      for (const e of events) {
        byKind[e.kind] = byKind[e.kind] || { count: 0, totalMs: 0, failed: 0 };
        byKind[e.kind].count++;
        byKind[e.kind].totalMs += e.durationMs || 0;
        if (e.status === 'error' || e.status === 'fail') byKind[e.kind].failed++;
      }
      return {
        traceId: runId,
        wallClockMs: Date.now() - t0,
        llmCalls: byKind.llm?.count || 0,
        agentSpans: byKind.agent?.count || 0,
        gateSpans: byKind.gate?.count || 0,
        errorCount: byKind.error?.count || 0,
        byKind,
        costNote: 'token usage not reported by provider calls; counted as calls + durations only',
      };
    },

    toJSON() {
      return { schemaVersion: 1, traceId: runId, summary: this.summary(), events };
    },
  };
}

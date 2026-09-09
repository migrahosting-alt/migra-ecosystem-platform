/**
 * EMAIL OBSERVABILITY — measurable without becoming a copy of the mailbox.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE HAZARD IS THE LABELS, NOT THE METRICS
 *
 * Metrics are retained, aggregated, shipped to dashboards and read by people
 * who have no business reading someone's mail. A label carrying an email
 * address, a subject line or a message id turns a monitoring system into a
 * partial mirror of the mailbox — one with weaker access control than the
 * mailbox itself, and a much longer retention period.
 *
 * High cardinality makes it worse in the same direction: per-address labels
 * both leak and blow up the series count, so the thing that protects privacy
 * also protects the metrics backend.
 *
 * So events carry SHAPES, not content: how long, which stage, which failure
 * kind, how many. Never who, never about what.
 */

/** Every stage worth timing. Named, so a slow lane is identifiable. */
export type EmailStage =
  | 'plan'
  | 'connection_check'
  | 'search'
  | 'read_message'
  | 'read_thread'
  | 'attachment_list'
  | 'attachment_read'
  /* Orchestration over evidence already read — never a provider operation. */
  | 'summarize'
  | 'draft_compose'
  | 'send_propose'
  | 'send_dispatch';

/** Outcomes, matching the failure enumeration exactly. */
export type EmailEventOutcome =
  | 'ok'
  | 'not_configured'
  | 'not_connected'
  | 'authorization_expired'
  | 'insufficient_scope'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'no_results'
  | 'not_found'
  | 'refused'
  | 'consent_declined'
  | 'outcome_unknown';

/**
 * One event. Every field is a bounded enum or a number.
 *
 * There is deliberately no `detail`, no `subject`, no `address`, no
 * `messageId` — not even optional. A field that CAN carry content eventually
 * does, because someone debugging at 2am adds the one value that would have
 * answered their question.
 */
export interface EmailTelemetryEvent {
  stage: EmailStage;
  outcome: EmailEventOutcome;
  durationMs: number;
  /** How many results/messages/attachments. A count is not content. */
  count?: number;
  /** Provider identity is a fixed, tiny set — safe as a label. */
  provider: string;
}

export type EmailTelemetrySink = (event: EmailTelemetryEvent) => void;

const NOOP: EmailTelemetrySink = () => {};

/**
 * Vocabulary that must never appear in a telemetry field.
 *
 * Exported so the test asserts against THIS list rather than restating it — a
 * guard that re-describes the rule drifts away from it.
 */
export const FORBIDDEN_LABEL_CONTENT: readonly string[] = Object.freeze([
  '@',           // any address
  'subject',
  'body',
  'snippet',
  'messageId',
  'threadId',
  'token',
  'refresh',
  'authorization',
]);

/**
 * Guard an event before it reaches a sink.
 *
 * Runtime enforcement rather than documentation: the type system stops a field
 * being ADDED, and this stops content arriving in a field that already exists —
 * a provider id set to an address, a stage string built from a subject.
 *
 * Returns null when the event is unsafe, so a caller drops it rather than
 * throwing. Losing one metric is preferable to an outage, and to a leak.
 */
export function safeEvent(event: EmailTelemetryEvent): EmailTelemetryEvent | null {
  const provider = event.provider;
  if (typeof provider !== 'string' || provider.length === 0 || provider.length > 32) return null;
  for (const forbidden of FORBIDDEN_LABEL_CONTENT) {
    if (provider.toLowerCase().includes(forbidden)) return null;
  }
  if (!Number.isFinite(event.durationMs) || event.durationMs < 0) return null;
  if (event.count !== undefined && (!Number.isInteger(event.count) || event.count < 0)) return null;
  return event;
}

/** A sink that drops anything unsafe. Wrap every real sink in this. */
export function guarded(sink: EmailTelemetrySink = NOOP): EmailTelemetrySink {
  return (event) => {
    const safe = safeEvent(event);
    if (!safe) return;
    try {
      sink(safe);
    } catch {
      // Telemetry never breaks the operation it is measuring.
    }
  };
}

/** Time one stage and emit exactly one event for it. */
export async function measured<T>(
  sink: EmailTelemetrySink,
  stage: EmailStage,
  provider: string,
  now: () => number,
  run: () => Promise<{ value: T; outcome: EmailEventOutcome; count?: number }>,
): Promise<T> {
  const started = now();
  try {
    const { value, outcome, count } = await run();
    sink({ stage, outcome, provider, durationMs: now() - started, ...(count !== undefined ? { count } : {}) });
    return value;
  } catch (error) {
    /*
     * A thrown error is still a measurement. The exception's MESSAGE is
     * deliberately not recorded — that is where a provider would put an
     * address or a subject line.
     */
    sink({ stage, outcome: 'provider_unavailable', provider, durationMs: now() - started });
    throw error;
  }
}

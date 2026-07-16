// Structured, LOCAL-ONLY MigraAI Engine routing diagnostics (observability).
// Records which model the engine selected for a chat turn and any models it
// failed over from, so the choice is inspectable without guessing.
//
// SANITIZED BY CONSTRUCTION: an event contains only the model id, provider,
// tier, a short human routing reason, and the list of failed-over model ids —
// all non-sensitive engine metadata. It NEVER contains prompts, attachments,
// completion text, tokens, provider keys, authorization headers, URLs, or raw
// provider error bodies. Purely observational: nothing here influences routing.

export interface EngineRoutingEvent {
  at: number;
  /** Model the engine committed to (post-failover). */
  model: string;
  provider: string;
  tier: string;
  /** Short human-readable routing rationale from the engine. */
  reason: string;
  /** Models tried and skipped before the committed one (e.g. couldn't load). */
  failedOver: string[];
  /** Coarse outcome of the turn. */
  outcome: 'streaming' | 'completed' | 'cancelled' | 'error';
  /** Non-sensitive token counts, when the engine reported them. */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface EngineDiagnosticSnapshot {
  current?: EngineRoutingEvent;
  history: EngineRoutingEvent[];
}

export class EngineDiagnostics {
  private history: EngineRoutingEvent[] = [];

  constructor(
    private readonly clock: () => number,
    private readonly max = 20,
  ) {}

  /** Record a committed route (called on the engine's `route` frame). Returns the
   * event so the caller can update its outcome/usage as the turn progresses. */
  record(route: { model: string; provider: string; tier: string; reason: string; failedOver: string[] }): EngineRoutingEvent {
    const event: EngineRoutingEvent = {
      at: this.clock(),
      model: route.model,
      provider: route.provider,
      tier: route.tier,
      reason: route.reason,
      failedOver: [...route.failedOver],
      outcome: 'streaming',
    };
    this.history.push(event);
    if (this.history.length > this.max) {
      this.history.shift();
    }
    return event;
  }

  /** Update the latest event's terminal outcome + usage. Observational only. */
  finish(outcome: EngineRoutingEvent['outcome'], usage?: { inputTokens: number; outputTokens: number }): void {
    const last = this.history[this.history.length - 1];
    if (last && last.outcome === 'streaming') {
      last.outcome = outcome;
      if (usage) last.usage = usage;
    }
  }

  snapshot(): EngineDiagnosticSnapshot {
    return { current: this.history[this.history.length - 1], history: [...this.history] };
  }

  clear(): void {
    this.history = [];
  }
}

/**
 * One line per Brain turn, under the id the caller already gave it.
 *
 * WHY THIS EXISTS. The consumer's trace can see the whole turn from outside and
 * nothing from inside: a real turn measured 89.8s between "prompt stored" and
 * "the Brain's stream opened", with 624ms of generation after it. That single
 * opaque stage IS the product's latency, and attributing it needed the engine to
 * say where its own time went — model selection, retrieval, or waiting for a
 * provider to load a model.
 *
 * THE SAME ID, ON PURPOSE. `x-request-id` arrives from the consumer, so one grep
 * across two services returns both halves of one turn rather than two records
 * that have to be matched up by timestamp.
 *
 * Deliberately a near-copy of the consumer's shape rather than a shared package:
 * these are two independently deployed services, and coupling their release
 * cadence to a logging format would be the more expensive mistake.
 */

export interface BrainTraceLine {
  at: string;
  trace: string;
  outcome: string;
  at_ms: Record<string, number>;
  ms: Record<string, number>;
  total_ms: number;
  [field: string]: unknown;
}

export class BrainTurnTrace {
  readonly id: string;
  private readonly startedAt = performance.now();
  private readonly stages: { name: string; at: number }[] = [];
  private readonly fields: Record<string, unknown> = {};
  private finished = false;
  private readonly sink: (line: string) => void;

  constructor(id: string, sink: (line: string) => void = (line) => console.log(line)) {
    this.id = id;
    this.sink = sink;
  }

  mark(name: string): void {
    this.stages.push({ name, at: performance.now() - this.startedAt });
  }

  set(field: string, value: unknown): void {
    this.fields[field] = value;
  }

  build(outcome: string): BrainTraceLine {
    const at_ms: Record<string, number> = {};
    const ms: Record<string, number> = {};
    let previous = 0;
    for (const stage of this.stages) {
      /*
       * `ms` IS DERIVED FROM THE ROUNDED `at_ms`, not from the raw times.
       *
       * Rounding each independently means the two columns do not reconcile: with
       * stages at 20.6ms and 50.4ms, `at_ms` reads 21 and 50 while `ms` reads 21
       * and 30 — a reader adding them up gets a different total than the one
       * printed. They now agree by construction, at the cost of at most a
       * millisecond of precision that nobody reading a latency trace needs.
       */
      const at = Math.round(stage.at);
      at_ms[stage.name] = at;
      // Duplicate stage names would silently overwrite; the last one wins, which
      // is the honest reading for a stage that genuinely ran twice.
      ms[stage.name] = at - previous;
      previous = at;
    }
    return {
      at: new Date().toISOString(),
      trace: this.id,
      outcome,
      ...this.fields,
      at_ms,
      ms,
      total_ms: Math.round(performance.now() - this.startedAt),
    };
  }

  /**
   * IDEMPOTENT, so callers can guarantee a line in a `finally` without proving
   * no earlier path already emitted one. The first outcome wins: a specific one
   * beats the catch-all that follows it.
   *
   * `JSON.stringify` is what makes this safe to write to a shared log — a value
   * containing a newline cannot forge a second line.
   */
  finish(outcome: string): BrainTraceLine {
    const line = this.build(outcome);
    if (!this.finished) {
      this.finished = true;
      this.sink(`migrapilot.brain.turn ${JSON.stringify(line)}`);
    }
    return line;
  }
}

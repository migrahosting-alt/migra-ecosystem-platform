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
      at_ms[stage.name] = Math.round(stage.at);
      ms[stage.name] = Math.round(stage.at - previous);
      previous = stage.at;
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

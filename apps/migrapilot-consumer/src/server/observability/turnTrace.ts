import 'server-only'

import { randomBytes } from 'node:crypto'

/**
 * One id for one turn, from the send button to the rendered token.
 *
 * WHY THIS EXISTS. Every latency and correctness question about a chat turn was
 * answered by bisection: add a log, deploy, reproduce, read, remove, repeat.
 * The turn crosses a browser, a Next route, a gateway, the Brain, a model and an
 * SSE stream back, and nothing tied those six together — so "it took almost a
 * minute" could not be attributed to a stage without rebuilding the system to
 * ask. A misattributed stage is worse than no measurement: the first fix for the
 * 28s image turn went to the network, which was never the cost.
 *
 * ONE LINE PER TURN, NOT ONE PER STAGE. Interleaved per-stage lines from
 * concurrent turns have to be reassembled before they mean anything, and the
 * reassembly is where mistakes get made. A single line holds every stage of one
 * turn, so a slow turn is one grep and no arithmetic.
 *
 * MONOTONIC, NOT WALL CLOCK. These are durations; a clock adjustment mid-turn
 * must not be able to produce a negative stage.
 */

/**
 * The shape an inbound id must have to be adopted.
 *
 * THE BROWSER'S ID IS UNTRUSTED INPUT. It reaches this process's logs and the
 * Brain's durable audit store, so an arbitrary client string could inject
 * newlines into a log line, or be set to another turn's id to make two
 * conversations indistinguishable in the record. Anything that is not exactly
 * this shape is replaced rather than sanitised — there is no partial credit for
 * an identifier.
 */
export const REQUEST_ID_PATTERN = /^req_[0-9a-f]{16,32}$/

export const newRequestId = (): string => `req_${randomBytes(10).toString('hex')}`

/**
 * Take the browser's id when it is well-formed, mint one otherwise.
 *
 * Adopting the CLIENT's id is what makes the trace span the whole path: it
 * exists before the request is sent, so what the user did and what the server
 * did carry the same name even if the request never arrives.
 */
export function adoptRequestId(header: string | null | undefined): {
  id: string
  minted: boolean
} {
  if (typeof header === 'string' && REQUEST_ID_PATTERN.test(header)) {
    return { id: header, minted: false }
  }
  return { id: newRequestId(), minted: true }
}

export interface TraceLine {
  at: string
  trace: string
  outcome: string
  /** Milliseconds from the start of the turn to the END of each stage. */
  at_ms: Record<string, number>
  /** Milliseconds spent INSIDE each stage, which is what a reader wants. */
  ms: Record<string, number>
  total_ms: number
  [field: string]: unknown
}

export class TurnTrace {
  readonly id: string
  private readonly startedAt = performance.now()
  private readonly stages: { name: string; at: number }[] = []
  private readonly fields: Record<string, unknown> = {}
  private sink: (line: string) => void

  constructor(id: string, sink: (line: string) => void = (line) => console.log(line)) {
    this.id = id
    this.sink = sink
  }

  /** Close off a stage. Called AFTER the work, so the name describes what finished. */
  mark(name: string): void {
    this.stages.push({ name, at: performance.now() - this.startedAt })
  }

  /** Attach a fact about the turn: model, image sizes, whether it was grounded. */
  set(field: string, value: unknown): void {
    this.fields[field] = value
  }

  /** Milliseconds since the turn began. For a caller that needs the number itself. */
  elapsed(): number {
    return Math.round(performance.now() - this.startedAt)
  }

  build(outcome: string): TraceLine {
    const at_ms: Record<string, number> = {}
    const ms: Record<string, number> = {}
    let previous = 0
    for (const stage of this.stages) {
      at_ms[stage.name] = Math.round(stage.at)
      // Duplicate stage names would silently overwrite; the last one wins, which
      // is the honest reading for a stage that genuinely ran twice.
      ms[stage.name] = Math.round(stage.at - previous)
      previous = stage.at
    }
    return {
      at: new Date().toISOString(),
      trace: this.id,
      outcome,
      ...this.fields,
      at_ms,
      ms,
      total_ms: Math.round(performance.now() - this.startedAt),
    }
  }

  /**
   * Emit the turn.
   *
   * `JSON.stringify` is what makes this safe to write to a shared log: every
   * value is escaped, so a prompt containing a newline cannot forge a second
   * line. Nothing here should ever be built by string concatenation.
   */
  finish(outcome: string): TraceLine {
    const line = this.build(outcome)
    this.sink(`migrapilot.turn ${JSON.stringify(line)}`)
    return line
  }
}

/**
 * The browser's half of a turn's trace.
 *
 * WHY THE CLIENT MINTS THE ID. The two numbers a user actually feels — how long
 * until something appeared, and how long until it finished — can only be
 * measured here, from the moment they pressed send. A server-minted id starts at
 * the moment the request arrives, which excludes exactly the part the server
 * cannot see. Minting here and letting the server adopt it means one name spans
 * the click, the network, both services, the model, and the first painted token.
 *
 * The server still decides: a malformed id is replaced, and the `meta` frame
 * reports the name the turn was really recorded under. It is echoed back rather
 * than assumed.
 *
 * THIS IS DIAGNOSTIC, NOT PRODUCT. It writes to the console and nowhere else —
 * no beacon, no third party, no prompt text. What it records is durations and an
 * opaque id.
 */

const hex = (bytes: number): string => {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Matches the server's `REQUEST_ID_PATTERN`; a mismatch means the server replaces it. */
export const newRequestId = (): string => `req_${hex(10)}`

export interface ClientTurnTrace {
  readonly id: string
  /** The server's id once `meta` arrives — the same value unless ours was rejected. */
  adopt(serverId: unknown): void
  /** The first token reaching the transcript, which is when the wait ends. */
  firstToken(): void
  finish(outcome: string): void
}

export function startTurnTrace(id: string = newRequestId()): ClientTurnTrace {
  const started = performance.now()
  const at: Record<string, number> = {}
  let current = id
  let finished = false
  const since = () => Math.round(performance.now() - started)

  return {
    get id() {
      return current
    },
    adopt(serverId: unknown) {
      at.meta ??= since()
      if (typeof serverId === 'string' && serverId && serverId !== current) {
        // Ours was not adopted. Both names are printed: the marks so far were
        // recorded under the old one, and dropping it would break the link.
        at.replaced = since()
        console.info(`migrapilot.turn.client id ${current} replaced by server id ${serverId}`)
        current = serverId
      }
    },
    firstToken() {
      at.first_token ??= since()
    },
    /*
     * IDEMPOTENT, so the caller can guarantee it in a `finally` without having
     * to prove no earlier path already ran. The FIRST outcome wins: a specific
     * one recorded at a known exit beats the catch-all that follows it.
     */
    finish(outcome: string) {
      if (finished) return
      finished = true
      at.total = since()
      console.info(`migrapilot.turn.client ${JSON.stringify({ trace: current, outcome, ms: at })}`)
    },
  }
}

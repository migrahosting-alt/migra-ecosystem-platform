import 'server-only'

/**
 * Brain connection configuration. Server-only by construction.
 *
 * `BRAIN_BASE_URL` is intentionally NOT a `NEXT_PUBLIC_*` variable: the browser
 * must never learn where the Brain lives, because the browser must never be
 * able to reach it. The default matches the Brain's own bind
 * (`MIGRAPILOT_BRAIN_HOST=127.0.0.1`, `MIGRAPILOT_BRAIN_PORT=3988`).
 *
 * Production deployment is a separate, later gate: the Brain gets a private
 * listener reachable only from this application tier — never a public hostname.
 */
export interface BrainConfig {
  baseUrl: string
  timeoutMs: number
  /**
   * Total budget for a streaming turn.
   *
   * Separate from `timeoutMs` because the two measure different things: a
   * buffered call waits for a whole answer with nothing to show, while a stream
   * is already delivering. Sizing a stream by the buffered budget would sever a
   * working answer mid-sentence.
   */
  streamTimeoutMs: number
}

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_STREAM_TIMEOUT_MS = 600_000

export function brainConfig(): BrainConfig {
  const baseUrl = (process.env.BRAIN_BASE_URL ?? 'http://127.0.0.1:3988').replace(/\/+$/, '')

  const parsedTimeout = Number(process.env.BRAIN_TIMEOUT_MS)
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS

  const parsedStream = Number(process.env.BRAIN_STREAM_TIMEOUT_MS)
  const streamTimeoutMs =
    Number.isFinite(parsedStream) && parsedStream > 0 ? parsedStream : DEFAULT_STREAM_TIMEOUT_MS

  return { baseUrl, timeoutMs, streamTimeoutMs }
}

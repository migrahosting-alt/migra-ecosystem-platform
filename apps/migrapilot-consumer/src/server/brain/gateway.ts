import 'server-only'

import { requireSession } from '../auth'
import { UnauthenticatedError, type AppSession } from '../auth/authPort'
import { deriveBrainScope, isDerivedOwnerScope } from '../tenancy/ownerScope'
import { brainConfig } from './config'
import { InvalidOperationError, resolveOperation, type BrainOperation } from './operations'

/**
 * The one and only path from this application to the Brain.
 *
 *   Browser → Next.js authenticated server → Brain
 *
 * Never `Browser → Brain`, and never `Browser → X-Owner-Scope → Brain`.
 *
 * Three properties are enforced here rather than left to callers:
 *
 *   IDENTITY IS SERVER-DERIVED. The scope headers are built from the verified
 *   MigraAuth session by `deriveBrainScope`. No argument to this module can
 *   influence them; there is no parameter through which a caller could supply
 *   one, so a browser-supplied scope is not "ignored" so much as unrepresentable.
 *
 *   NO ARBITRARY PROXYING. Callers pass a `BrainOperation` from a closed union,
 *   never a path. Ids inside those operations are pattern-validated, so an id
 *   field cannot walk to a different Brain route.
 *
 *   ONLY ALLOWLISTED HEADERS LEAVE. The outbound header set is constructed from
 *   scratch. Inbound browser headers are never forwarded — not cookies, not
 *   authorization, not `x-owner-scope`.
 */

/** Every distinguishable outcome. Mirrors the extension's discrimination style. */
export type BrainResult<T> =
  | { kind: 'ok'; status: number; value: T }
  | { kind: 'unauthenticated'; detail: string }
  | { kind: 'tenancy_unresolved'; detail: string }
  | { kind: 'invalid_operation'; detail: string }
  | { kind: 'not_found' }
  | { kind: 'conflict'; status: number; body: unknown }
  | { kind: 'brain_error'; status: number; body: unknown }
  | { kind: 'timeout'; detail: string }
  | { kind: 'transport_failure'; detail: string }

/** Header names this gateway is permitted to send to the Brain. */
export const OUTBOUND_HEADER_ALLOWLIST = [
  'accept',
  'content-type',
  'x-owner-scope',
  'x-workspace-scope',
  'x-request-id',
] as const

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface GatewayDeps {
  /** Overridden in tests. Defaults to the platform fetch. */
  fetchImpl?: FetchLike
  /** Overridden in tests so a session can be supplied without a live auth port. */
  sessionProvider?: () => Promise<AppSession>
  requestId?: string
  /** Ties a stream to the caller's request, so a browser disconnect stops the model. */
  signal?: AbortSignal
}

function buildHeaders(scope: { owner: string; workspace: string }, requestId?: string): Headers {
  // Constructed from nothing — there is no inbound header object in scope.
  const headers = new Headers()
  headers.set('accept', 'application/json')
  headers.set('content-type', 'application/json')
  headers.set('x-owner-scope', scope.owner)
  headers.set('x-workspace-scope', scope.workspace)
  if (requestId) headers.set('x-request-id', requestId)

  // Defence in depth: assert we are emitting a scope this process derived.
  if (!isDerivedOwnerScope(headers.get('x-owner-scope') ?? '')) {
    throw new Error('Refusing to call the Brain with a non-derived owner scope.')
  }
  return headers
}

/** A request that has cleared authentication, tenancy and operation resolution. */
interface PreparedCall {
  url: string
  method: string
  headers: Headers
  body?: string
  timeoutMs: number
}

/**
 * The three boundary properties, applied once for every caller.
 *
 * Both the buffered and streaming paths go through here so that "authenticated,
 * server-derived scope, closed operation set" cannot hold for one and not the
 * other. A second entry point that re-implemented this preamble is exactly how
 * a streaming path would quietly become an unauthenticated proxy.
 */
async function prepareBrainCall(
  operation: BrainOperation,
  deps: GatewayDeps,
): Promise<{ ok: true; call: PreparedCall } | { ok: false; failure: BrainResult<never> }> {
  // 1. Principal first. No session, no Brain call — before anything else runs.
  let session: AppSession
  try {
    session = await (deps.sessionProvider ? deps.sessionProvider() : requireSession())
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, failure: { kind: 'unauthenticated', detail: error.message } }
    }
    return { ok: false, failure: { kind: 'unauthenticated', detail: 'Authentication required.' } }
  }

  // 2. Tenancy derived from that principal. Fails closed.
  let scope
  try {
    scope = deriveBrainScope(session)
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: 'tenancy_unresolved',
        detail: error instanceof Error ? error.message : 'Tenancy could not be resolved.',
      },
    }
  }

  // 3. Operation → concrete request. The only path constructor.
  let resolved
  try {
    resolved = resolveOperation(operation)
  } catch (error) {
    if (error instanceof InvalidOperationError) {
      return { ok: false, failure: { kind: 'invalid_operation', detail: error.message } }
    }
    throw error
  }

  const { baseUrl, timeoutMs, streamTimeoutMs } = brainConfig()
  return {
    ok: true,
    call: {
      url: `${baseUrl}${resolved.path}`,
      method: resolved.method,
      headers: buildHeaders(scope, deps.requestId),
      ...(resolved.body !== undefined ? { body: JSON.stringify(resolved.body) } : {}),
      // A stream is alive for as long as the model generates, so a total budget
      // sized for a buffered reply would sever a working answer mid-sentence.
      timeoutMs: isStreaming(operation) ? streamTimeoutMs : timeoutMs,
    },
  }
}

const isStreaming = (operation: BrainOperation): boolean =>
  operation.kind === 'chatTurn' && operation.stream === true

/**
 * Execute a Brain operation on behalf of the authenticated caller.
 *
 * Returns rather than throws for expected outcomes so callers must handle them
 * explicitly; only a programming error escapes as an exception.
 */
export async function callBrain<T = unknown>(
  operation: BrainOperation,
  deps: GatewayDeps = {},
): Promise<BrainResult<T>> {
  const prepared = await prepareBrainCall(operation, deps)
  if (!prepared.ok) return prepared.failure

  const { url, method, headers, body, timeoutMs } = prepared.call
  const fetchImpl = deps.fetchImpl ?? ((u, init) => fetch(u, init))

  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      redirect: 'error',
    })
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { kind: 'timeout', detail: `Brain did not respond within ${timeoutMs}ms.` }
    }
    return {
      kind: 'transport_failure',
      detail: error instanceof Error ? error.message : 'Brain transport failure.',
    }
  }

  let parsed: unknown = null
  const raw = await response.text().catch(() => '')
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }

  if (response.status === 404) return { kind: 'not_found' }
  if (response.status === 409) return { kind: 'conflict', status: 409, body: parsed }
  if (!response.ok) return { kind: 'brain_error', status: response.status, body: parsed }

  return { kind: 'ok', status: response.status, value: parsed as T }
}

/** One decoded server-sent event from the Brain. */
export interface BrainStreamFrame {
  event: string
  data: unknown
}

export type BrainStream =
  | { kind: 'ok'; frames: AsyncGenerator<BrainStreamFrame> }
  | Exclude<BrainResult<never>, { kind: 'ok' }>

/**
 * Open a streaming Brain operation and yield its decoded SSE frames.
 *
 * Identical trust boundary to `callBrain` — same preamble, same derived scope,
 * same closed operation set — differing only in that the response body is read
 * incrementally instead of buffered.
 *
 * The generator ends when the Brain ends the stream. Abandoning it (a `break`,
 * or the caller's own request aborting) releases the reader, which propagates
 * the disconnect upstream so a cancelled turn stops costing model time.
 */
export async function streamBrain(
  operation: BrainOperation,
  deps: GatewayDeps = {},
): Promise<BrainStream> {
  const prepared = await prepareBrainCall(operation, deps)
  if (!prepared.ok) return prepared.failure as Exclude<BrainResult<never>, { kind: 'ok' }>

  const { url, method, headers, body, timeoutMs } = prepared.call
  headers.set('accept', 'text/event-stream')
  const fetchImpl = deps.fetchImpl ?? ((u, init) => fetch(u, init))

  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: deps.signal ?? AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      redirect: 'error',
    })
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { kind: 'timeout', detail: `Brain did not respond within ${timeoutMs}ms.` }
    }
    return {
      kind: 'transport_failure',
      detail: error instanceof Error ? error.message : 'Brain transport failure.',
    }
  }

  if (response.status === 404) return { kind: 'not_found' }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    return { kind: 'brain_error', status: response.status, body: detail }
  }

  return { kind: 'ok', frames: decodeEventStream(response.body) }
}

/**
 * Decode `text/event-stream` into frames.
 *
 * Chunk boundaries are arbitrary, so events are only emitted on a complete
 * blank-line terminator. Splitting on whatever arrived in one `read()` would
 * corrupt any token that straddled a chunk — and multi-byte characters make
 * that routine, not rare.
 */
async function* decodeEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<BrainStreamFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const frame = parseEvent(raw)
        if (frame) yield frame
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    // Abandoning the generator must not leave the upstream connection open.
    await reader.cancel().catch(() => undefined)
  }
}

function parseEvent(raw: string): BrainStreamFrame | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null

  const payload = dataLines.join('\n')
  try {
    return { event, data: JSON.parse(payload) }
  } catch {
    return { event, data: payload }
  }
}

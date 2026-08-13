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
  // 1. Principal first. No session, no Brain call — before anything else runs.
  let session: AppSession
  try {
    session = await (deps.sessionProvider ? deps.sessionProvider() : requireSession())
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { kind: 'unauthenticated', detail: error.message }
    }
    return { kind: 'unauthenticated', detail: 'Authentication required.' }
  }

  // 2. Tenancy derived from that principal. Fails closed.
  let scope
  try {
    scope = deriveBrainScope(session)
  } catch (error) {
    return {
      kind: 'tenancy_unresolved',
      detail: error instanceof Error ? error.message : 'Tenancy could not be resolved.',
    }
  }

  // 3. Operation → concrete request. The only path constructor.
  let resolved
  try {
    resolved = resolveOperation(operation)
  } catch (error) {
    if (error instanceof InvalidOperationError) {
      return { kind: 'invalid_operation', detail: error.message }
    }
    throw error
  }

  const { baseUrl, timeoutMs } = brainConfig()
  const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init))
  const headers = buildHeaders(scope, deps.requestId)

  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}${resolved.path}`, {
      method: resolved.method,
      headers,
      ...(resolved.body !== undefined ? { body: JSON.stringify(resolved.body) } : {}),
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

  let body: unknown = null
  const raw = await response.text().catch(() => '')
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
  }

  if (response.status === 404) return { kind: 'not_found' }
  if (response.status === 409) return { kind: 'conflict', status: 409, body }
  if (!response.ok) return { kind: 'brain_error', status: response.status, body }

  return { kind: 'ok', status: response.status, value: body as T }
}

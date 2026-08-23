/**
 * The caller's MigraPilot preferences.
 *
 * MIGRAPILOT-OWNED ONLY. Name, email, avatar, verified state, linked providers
 * and sessions are MigraAuth's and are read from MigraAuth — never mirrored
 * here, because a second copy drifts the first time one side changes.
 *
 * A PATCH returns the FULL document the server now holds, not an echo of what
 * was sent. That is what lets an optimistic UI be honest: a value the server
 * clamped or rejected comes back as the value it actually stored, so the screen
 * reconciles to the truth instead of to its own guess.
 */

import { getPreferences, patchPreferences } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'

export const dynamic = 'force-dynamic'

const fail = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

/**
 * One mapping, so read and write cannot drift apart in how they fail.
 *
 * `verb` only changes the WORDING. A read that failed must not say "could not be
 * saved" — the user did not ask to save anything, and a message about the wrong
 * operation makes a working screen look broken.
 */
function refusal(
  kind: string,
  body?: unknown,
  verb: 'load' | 'save' = 'save',
): { status: number; error: string; message: string } {
  const code = (() => {
    const parsed = typeof body === 'string' ? (() => { try { return JSON.parse(body) } catch { return null } })() : body
    return (parsed as { code?: string } | null)?.code
  })()

  if (code === 'INSTRUCTIONS_TOO_LONG') {
    return { status: 400, error: 'instructions_too_long', message: 'Your custom instructions are too long to save.' }
  }
  if (code === 'PERSISTENCE_UNAVAILABLE') {
    return {
      status: 503,
      error: 'persistence_unavailable',
      // Said plainly, because the UI must NOT show this as saved.
      message:
        verb === 'load'
          ? 'Settings storage is unavailable right now, so your settings could not be loaded.'
          : 'Settings storage is unavailable right now, so nothing was saved. Try again shortly.',
    }
  }
  switch (kind) {
    case 'unauthenticated':
      return { status: 401, error: 'unauthenticated', message: 'Sign in to manage your settings.' }
    case 'forbidden_for_principal':
      return { status: 403, error: 'requires_account', message: 'That setting needs an account.' }
    case 'invalid_operation':
      return { status: 400, error: 'invalid_request', message: 'That is not a setting MigraPilot recognises.' }
    case 'timeout':
    case 'transport_failure':
      return {
        status: 503,
        error: 'unreachable',
        message:
          verb === 'load'
            ? 'Settings could not be reached right now.'
            : 'Settings could not be reached right now. Nothing was saved.',
      }
    default:
      return verb === 'load'
        ? { status: 502, error: 'load_failed', message: 'Your settings could not be loaded.' }
        : { status: 502, error: 'save_failed', message: 'That change could not be saved.' }
  }
}

export async function GET(): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved) return fail(401, 'unauthenticated', 'Sign in to manage your settings.')

  const result = await getPreferences({ principal: resolved.principal })
  if (result.kind !== 'ok') {
    const r = refusal(result.kind, 'body' in result ? result.body : undefined, 'load')
    return fail(r.status, r.error, r.message)
  }

  return Response.json({
    preferences: result.value.preferences,
    // False means nobody has chosen anything yet, so the UI can say "using
    // defaults" rather than implying a saved decision.
    stored: result.value.stored,
    updatedAt: result.value.updatedAt ?? 0,
  })
}

export async function PATCH(request: Request): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved) return fail(401, 'unauthenticated', 'Sign in to manage your settings.')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid_body', 'Expected a JSON body.')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'invalid_body', 'Expected an object of settings to change.')
  }

  const result = await patchPreferences(body as Record<string, unknown>, { principal: resolved.principal })
  if (result.kind !== 'ok') {
    const r = refusal(result.kind, 'body' in result ? result.body : undefined)
    return fail(r.status, r.error, r.message)
  }

  return Response.json({
    preferences: result.value.preferences,
    changed: result.value.changed ?? [],
  })
}

/**
 * Detaching a sign-in provider.
 *
 * THE SAFEGUARD IS MIGRAAUTH'S, NOT THIS ROUTE'S. Unlinking the only way into an
 * account locks its owner out permanently, and the button that does it looks
 * exactly like a preference. MigraAuth refuses that with `last_sign_in_method`,
 * and this route forwards the refusal rather than reimplementing the rule —
 * two copies of a safety check drift, and the copy that drifts is the one that
 * stops protecting anyone.
 *
 * The UI also disables the control using `can_unlink_a_provider`, but that is a
 * courtesy: it explains the situation before the click. The server is what makes
 * it true.
 *
 * LINKING is not here. Adding a provider means sending the browser to that
 * provider and back, which is MigraAuth's social flow — a JSON route cannot
 * complete it, and pretending otherwise would produce a button that fails.
 */

import { migraAuthFetch, persistRenewal } from '@/server/auth/migraAuthApi'

export const dynamic = 'force-dynamic'

/** Providers this app will forward. Anything else is refused before it leaves. */
const KNOWN_PROVIDERS = new Set(['google', 'github'])

export async function DELETE(request: Request): Promise<Response> {
  const provider = new URL(request.url).searchParams.get('provider')?.toLowerCase() ?? ''

  if (!KNOWN_PROVIDERS.has(provider)) {
    return Response.json(
      { error: 'unknown_provider', message: 'That sign-in method is not one this account can use.' },
      { status: 400 },
    )
  }

  const result = await migraAuthFetch<{ error?: { code?: string; message?: string } }>(
    `/v1/social/${provider}/link`,
    { method: 'DELETE' },
  )
  await persistRenewal(result)

  if (result.kind === 'unauthenticated') {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (result.kind === 'reauth_required') {
    return Response.json(
      { error: 'reauth_required', message: 'Sign in again to change your sign-in methods.' },
      { status: 409 },
    )
  }

  /*
   * A REFUSAL IS NOT AN OUTAGE. `last_sign_in_method` is MigraAuth protecting
   * the account, and it carries a message that tells the person what to do
   * instead ("set a password first"). Flattening it into "something went wrong"
   * would turn a clear instruction into a mystery.
   */
  if (result.kind === 'refused') {
    const code = result.value?.error?.code ?? 'refused'
    return Response.json(
      {
        error: code,
        message:
          result.value?.error?.message ??
          'That sign-in method could not be removed. Nothing was changed.',
      },
      { status: code === 'last_sign_in_method' ? 409 : 400 },
    )
  }

  if (result.kind !== 'ok') {
    return Response.json(
      { error: 'unavailable', message: 'That could not be changed right now. Nothing was removed.' },
      { status: 503 },
    )
  }

  return Response.json({ unlinked: provider })
}

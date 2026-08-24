/**
 * The account, as MigraAuth holds it.
 *
 * READ THROUGH, NEVER MIRRORED. Name, email, verified state and linked providers
 * are fetched from MigraAuth on every request. A cached copy is a second truth
 * that goes stale the moment the account changes elsewhere — and Settings is
 * exactly the screen where being stale is worst.
 *
 * `reauth_required` is a real, reportable state rather than a failure: a session
 * created before this app began keeping tokens is genuinely signed in but cannot
 * read MigraAuth for that person. The UI says so and offers a sign-in, which is
 * recoverable. Inventing an empty provider list would not be.
 */

import { migraAuthFetch, persistRenewal } from '@/server/auth/migraAuthApi'

export const dynamic = 'force-dynamic'

/** MigraAuth's answer to "what can this account actually do?". */
interface SecurityResponse {
  mfa_enabled: boolean
  /** True when this account holds recovery codes that CANNOT be redeemed. */
  recovery_codes_stale: boolean
  has_password: boolean
  password_updated_at: string | null
  email_verified: boolean
  linked_providers: string[]
  sign_in_methods: number
  can_unlink_a_provider: boolean
}

interface MeResponse {
  user?: {
    id: string
    email: string | null
    status: string
    email_verified: boolean
    display_name: string | null
  }
}

interface LinksResponse {
  links?: {
    provider: string
    email: string | null
    display_name: string | null
    linked_at: string
    last_used_at: string | null
  }[]
}

export async function GET(): Promise<Response> {
  /*
   * THE FIRST CALL IS DELIBERATELY ALONE, AND THE RENEWAL IS SAVED BEFORE THE
   * OTHERS RUN.
   *
   * These three used to go out in one `Promise.all`. With an expired access
   * token that is not merely wasteful — it is destructive. All three would read
   * the same refresh token from the session and redeem it concurrently;
   * MigraAuth rotates refresh tokens strictly once and treats a second
   * presentation as theft, revoking the ENTIRE FAMILY. So the parallel version
   * signed the user out precisely when it tried to keep them signed in, and did
   * it every time the token had expired.
   *
   * Serialising the first call means exactly one refresh happens. Persisting it
   * before the next two means they read the NEW token from the session — Next's
   * cookie store is request-scoped and reflects the write — so they never
   * present the rotated one.
   */
  const me = await migraAuthFetch<MeResponse>('/v1/me')
  await persistRenewal(me)

  const [links, security] = await Promise.all([
    migraAuthFetch<LinksResponse>('/v1/social/links'),
    migraAuthFetch<SecurityResponse>('/v1/me/security'),
  ])

  if (me.kind === 'unauthenticated') {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (me.kind === 'reauth_required') {
    return Response.json(
      {
        error: 'reauth_required',
        message: 'Sign in again to manage your account details.',
      },
      { status: 409 },
    )
  }
  if (me.kind !== 'ok' || !me.value?.user) {
    return Response.json(
      { error: 'unavailable', message: 'Your account details could not be loaded right now.' },
      { status: 503 },
    )
  }

  const user = me.value.user
  return Response.json({
    profile: {
      // Deliberately narrow. The account id is included because unlinking and
      // session revocation are scoped by it in the UI; nothing token-shaped is.
      id: user.id,
      email: user.email,
      emailVerified: user.email_verified,
      displayName: user.display_name,
      status: user.status,
    },
    /*
     * A failed provider read is reported as UNKNOWN rather than as none. "You
     * have no linked accounts" and "we could not check" look identical on screen
     * and mean opposite things — one of them invites you to unlink your last
     * sign-in method.
     */
    linkedProviders: links.kind === 'ok' ? (links.value?.links ?? []) : null,
    /*
     * Same rule, and it matters more here. An unknown security state rendered as
     * `false` would tell someone MFA is off when it may be on, and would offer
     * "Set a password" to an account that already has one. Null means the card
     * says it could not check.
     */
    security: security.kind === 'ok' ? (security.value ?? null) : null,
  })
}

/**
 * Editing the profile — one field, written straight through to MigraAuth.
 *
 * NOTHING IS STORED HERE. The display name lives in exactly one place, and this
 * route is a pass-through so the app never becomes a second copy that disagrees
 * with the account it is describing.
 */
export async function PATCH(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const raw = (body as { displayName?: unknown })?.displayName
  if (raw !== null && typeof raw !== 'string') {
    return Response.json(
      { error: 'invalid', message: 'A display name must be text, or null to clear it.' },
      { status: 400 },
    )
  }
  if (typeof raw === 'string' && raw.length > 120) {
    // Refused rather than truncated: silently storing a shortened version of
    // someone's name and showing it back as if they chose it is worse than
    // saying it is too long.
    return Response.json(
      { error: 'too_long', message: 'A display name can be at most 120 characters.' },
      { status: 400 },
    )
  }

  const updated = await migraAuthFetch<MeResponse>('/v1/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ display_name: raw }),
  })
  await persistRenewal(updated)

  if (updated.kind === 'unauthenticated') {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (updated.kind === 'reauth_required') {
    return Response.json(
      { error: 'reauth_required', message: 'Sign in again to change your profile.' },
      { status: 409 },
    )
  }
  if (updated.kind !== 'ok' || !updated.value?.user) {
    return Response.json(
      { error: 'unavailable', message: 'Your name could not be saved. Nothing was changed.' },
      { status: 503 },
    )
  }

  // The SAVED value is returned, not the submitted one, so the screen reconciles
  // against what MigraAuth actually stored.
  return Response.json({ displayName: updated.value.user.display_name })
}

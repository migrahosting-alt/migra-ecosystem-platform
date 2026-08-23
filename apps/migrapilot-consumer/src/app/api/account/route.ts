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

import { migraAuthFetch } from '@/server/auth/migraAuthApi'

export const dynamic = 'force-dynamic'

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
  const [me, links] = await Promise.all([
    migraAuthFetch<MeResponse>('/v1/me'),
    migraAuthFetch<LinksResponse>('/v1/social/links'),
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
  })
}

/**
 * What the account screen shows about a connected mailbox.
 *
 * ---------------------------------------------------------------------------
 * 🚨 "COULD NOT CHECK" IS NOT "NOT CONNECTED"
 *
 * They look identical in a UI and mean opposite things. Rendering an
 * unreachable server as "not connected" shows a Connect button to someone whose
 * mailbox IS connected — and pressing it walks them through a consent screen to
 * re-grant access they already gave.
 *
 * The same mistake in reverse is worse: rendering a failure as "connected"
 * would claim we can read mail we cannot.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS CARD IS NOT "CONNECTED ACCOUNTS"
 *
 * That card lists ways to SIGN IN. This one is delegated access to a
 * third-party data source. Merging them would let someone believe that
 * disconnecting their mailbox removed a way into their own account.
 */

export type MailCardState =
  /** The request is in flight. Never rendered as an answer. */
  | { kind: 'checking' }
  /** The deployment has no email at all. An operator's problem. */
  | { kind: 'not_configured'; reason: string }
  /** We could not reach the server. NOT a claim about the connection. */
  | { kind: 'unknown'; reason: string }
  /** Signed out. Nothing can be said about an account we cannot identify. */
  | { kind: 'signed_out'; reason: string }
  | { kind: 'not_connected' }
  | { kind: 'connected'; account: string; canRead: boolean }
  /** They DID connect; the grant stopped working. */
  | { kind: 'expired'; reason: string }
  /** Connected and authorised; the provider is not answering. */
  | { kind: 'provider_unavailable'; reason: string }

export interface MailStatusBody {
  state?: unknown
  account?: unknown
  scopes?: { read?: unknown }
  reason?: unknown
  error?: unknown
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value ? value : fallback

/**
 * Map an HTTP answer to what the card shows.
 *
 * `status` is the transport's verdict and `body` is the engine's. Both are
 * needed: a 200 carrying an unrecognised state is not a licence to guess.
 */
export function mailCardState(status: number, body: MailStatusBody | null): MailCardState {
  if (status === 401) {
    return { kind: 'signed_out', reason: text(body?.reason, 'Sign in to connect your email.') }
  }
  if (status !== 200 || !body) {
    return { kind: 'unknown', reason: 'Your email connection could not be checked just now.' }
  }

  switch (body.state) {
    case 'not_configured':
      return { kind: 'not_configured', reason: text(body.reason, 'Email is not set up yet.') }
    case 'not_connected':
      return { kind: 'not_connected' }
    case 'authorization_expired':
      return { kind: 'expired', reason: text(body.reason, 'Your email account needs reconnecting.') }
    case 'provider_unavailable':
      return { kind: 'provider_unavailable', reason: text(body.reason, 'Email is unavailable right now.') }
    case 'connected':
      return {
        kind: 'connected',
        // Display only. An address is not an identity and is never sent back.
        account: text(body.account, ''),
        canRead: body.scopes?.read === true,
      }
    default:
      /*
       * 🚨 An unrecognised state is UNKNOWN, never "not connected". A newer
       * engine reporting a state this build has not learned yet must not be
       * rendered as an invitation to connect an account that already is.
       */
      return { kind: 'unknown', reason: 'Your email connection could not be checked just now.' }
  }
}

/** Whether the card should offer to start (or restart) a connection. */
export function offersConnect(state: MailCardState): boolean {
  return state.kind === 'not_connected' || state.kind === 'expired'
}

/**
 * Whether the card should offer to disconnect.
 *
 * 🚨 Offered for an EXPIRED grant too. The row still exists, we still hold a
 * refresh token, and "remove it" is a legitimate thing to want — hiding the
 * control there would strand a dead connection with no way to clear it.
 */
export function offersDisconnect(state: MailCardState): boolean {
  return state.kind === 'connected' || state.kind === 'expired' || state.kind === 'provider_unavailable'
}

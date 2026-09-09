/**
 * What the browser is told after coming back from a consent screen.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE OUTCOME TRAVELS AS A TOKEN, NOT AS A MESSAGE
 *
 * The callback route redirects with `?mail=connected|failed|signin` and nothing
 * else. It deliberately does NOT carry the Brain's sentence in the URL, and it
 * certainly does not carry Google's: a query string is logged by proxies, kept
 * in history, and sent onward in a Referer header. A refusal that named which
 * check failed would put a probing oracle in a place that leaks by design.
 *
 * So the words live here, and this file owns them.
 *
 * ---------------------------------------------------------------------------
 * 🚨 AN UNKNOWN TOKEN RENDERS NOTHING
 *
 * Not a generic error. `?mail=` is user-editable and appears in shared links;
 * turning anything unrecognised into "something went wrong" would let a pasted
 * URL manufacture a failure for a connection that is working perfectly well.
 */

export type MailOutcomeTone = 'success' | 'warning'

export interface MailOutcomeNotice {
  tone: MailOutcomeTone
  message: string
}

const NOTICES: Readonly<Record<string, MailOutcomeNotice>> = Object.freeze({
  connected: { tone: 'success', message: 'Your email is connected.' },
  /*
   * One sentence for every refusal — forged state, replay, expiry, principal
   * mismatch. Distinguishing them here would rebuild, in the browser, the
   * probing oracle the Brain refuses to provide.
   */
  failed: {
    tone: 'warning',
    message: 'Your email could not be connected. Try connecting it again.',
  },
  /* Their session ended while they were away. Retrying is not the remedy. */
  signin: { tone: 'warning', message: 'Sign in to connect your email.' },
})

export function mailOutcomeNotice(token: unknown): MailOutcomeNotice | null {
  if (typeof token !== 'string' || !token) return null
  return NOTICES[token] ?? null
}

/** The query parameter the callback route sets. Named once. */
export const MAIL_OUTCOME_PARAM = 'mail'

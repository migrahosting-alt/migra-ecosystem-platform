/**
 * "Has this session authenticated recently enough to stand in for a credential
 * it cannot produce?"
 *
 * Its own module because it is the only part of the password-management policy
 * with a NUMBER in it, and a number that is quietly wrong — a window measured in
 * hours, or a comparison that lets an impossible age through — is not visible in
 * a reading of the route.
 */

/**
 * Long enough to walk from the sign-in page to the security page and fill in a
 * form; short enough that an unattended browser is not a standing offer to add
 * a permanent way into the account.
 */
export const RECENT_AUTH_WINDOW_MS = 15 * 60_000;

/**
 * REFRESHING IS NOT RE-AUTHENTICATING, and this only works because of that.
 *
 * `rotateAuthSession` UPDATES the existing session row — new secret, new expiry,
 * same `createdAt` — so creation time keeps meaning "when a human last proved
 * who they were", however many times the token behind it has rotated. If
 * rotation ever starts INSERTING a row, this silently becomes "was a token
 * refreshed recently", which is a different and much weaker question. There is a
 * test pinning that rotation updates rather than creates.
 */
export function authenticatedRecently(
  session: { createdAt: Date },
  now: number = Date.now(),
): boolean {
  const age = now - session.createdAt.getTime();
  /*
   * A NEGATIVE AGE IS NOT "VERY RECENT". Clock skew between the database and
   * this process can put `createdAt` in the future, and a bare `age <= WINDOW`
   * would then be true for a session created an arbitrary distance ahead — the
   * check would pass hardest exactly where the clocks are least trustworthy.
   */
  return age >= 0 && age <= RECENT_AUTH_WINDOW_MS;
}

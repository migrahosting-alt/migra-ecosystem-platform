/**
 * Password management for provider-only accounts.
 *
 * THE DEFECT THIS CLOSES. "Manage password" opened the SESSION LIST, and there
 * was no signed-in route to a password at all — `/v1/reset-password` needs a
 * token mailed to a verified address, which is a recovery flow for someone
 * locked out, not a way to deliberately add a credential. An account created
 * through Google or GitHub was therefore permanently one credential wide, while
 * `unlinkProvider` told its owner to "Set a password first" — advice pointing at
 * nothing.
 *
 * These pin the parts that fail SILENTLY or fail people:
 *   1. No password surface may route to /sessions.
 *   2. A provider-only account must never be asked for a password it never had.
 *   3. An account that HAS a password must prove it (or a second factor);
 *      a merely recent sign-in is not enough for them.
 *   4. Linked identities are never touched by setting a password.
 *   5. The sign-in-method count is read back AFTER the write.
 *   6. Session freshness means AUTHENTICATION, not token refresh.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authenticatedRecently, RECENT_AUTH_WINDOW_MS } from "./recentAuth.js";

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
const src = (relative: string) => read(join("src", relative));
const web = (relative: string) => read(join("..", "auth-web", "src", relative));

const routes = src("routes/auth.ts");
const handler = routes.slice(routes.indexOf('app.post("/v1/me/password"'));
const page = web("app/account/password/page.tsx");

test("the password route exists and is behind a real session guard", () => {
  assert.match(routes, /app\.post\("\/v1\/me\/password",\s*\{\s*preHandler:\s*requireAuthenticatedUser\s*\}/);
  /*
   * requireAuthenticatedUser routes through validateSession, which filters
   * `mfaPendingAt: null` — so a half-authenticated session cannot set a
   * password. That inheritance is the reason this guard is the right one, and
   * the reason nothing MFA-specific appears here.
   */
});

test("a provider-only account is never asked for a password it never had", () => {
  /*
   * THE ONE-WAY DOOR, IN BOTH LAYERS. Demanding `current_password`
   * unconditionally is what made POST /v1/mfa/disable unreachable for Google
   * and GitHub accounts. The server only consults it when a password exists...
   */
  assert.match(handler, /if \(isChange && body\.current_password\)/);

  // ...and the form only renders the field in that case.
  assert.match(page, /\{isChange \? \(\s*<PasswordInput\s+label="Current password"/);
});

test("an account WITH a password cannot rely on a recent sign-in alone", () => {
  /*
   * The recent-authentication path is gated on `!isChange`. If that guard is
   * ever dropped, anyone holding a fresh session could replace a password
   * without knowing the old one — a silent downgrade of every password account.
   */
  assert.match(handler, /if \(!method && !isChange && !before\.mfa_enabled && authenticatedRecently\(session\)\)/);
});

test("a recovery code is only spent after the cheaper proofs fail", () => {
  const currentAt = handler.indexOf("body.current_password");
  const totpAt = handler.indexOf("verifyTotp(");
  const recoveryAt = handler.indexOf("consumeRecoveryCode(");
  assert.ok(currentAt > 0 && totpAt > currentAt, "TOTP must be tried after the current password");
  assert.ok(recoveryAt > totpAt, "a recovery code must be the LAST thing tried, never the first");
});

test("setting a password never touches linked identities", () => {
  /*
   * A password is an ADDITIONAL way in. If this handler ever writes to
   * userLinkedIdentity, setting a password could cost someone the Google
   * account they have been signing in with.
   */
  assert.doesNotMatch(handler, /userLinkedIdentity\.(delete|deleteMany|update|updateMany|create)/);
  assert.match(handler, /await changePassword\(user\.id, body\.new_password\)/);
});

test("the safeguard count is read back after the write, not assumed", () => {
  const writeAt = handler.indexOf("await changePassword(");
  const afterAt = handler.indexOf("const after = await securityFacts(user)");
  assert.ok(writeAt > 0 && afterAt > writeAt, "facts must be re-read AFTER the password is written");
  // And returned, so the UI updates the safeguard without a second round trip.
  assert.match(handler, /\.\.\.after,/);
});

test("both outcomes are audited, and distinguishably", () => {
  assert.match(handler, /eventType: isChange \? "PASSWORD_CHANGED" : "PASSWORD_SET"/);
  assert.match(handler, /eventType: "PASSWORD_CHANGE_FAILURE"/);
  assert.match(handler, /reauthenticated_with: method/);

  const audit = src("modules/audit/index.ts");
  for (const type of ["PASSWORD_SET", "PASSWORD_CHANGED", "PASSWORD_CHANGE_FAILURE"]) {
    assert.ok(audit.includes(`"${type}"`), `${type} must be a known auth-timeline event`);
  }
});

test("re-setting the same password is refused, not silently accepted", () => {
  /*
   * Reporting success while changing nothing is the worst answer for someone
   * who came here because they believe their password is known to someone else.
   */
  assert.match(handler, /code: "password_unchanged"/);
});

test("the recent-auth window is enforced at its real boundary", () => {
  const now = Date.UTC(2026, 7, 24, 12, 0, 0);
  const at = (msAgo: number) => ({ createdAt: new Date(now - msAgo) });

  assert.equal(authenticatedRecently(at(0), now), true, "just signed in");
  assert.equal(authenticatedRecently(at(RECENT_AUTH_WINDOW_MS - 1), now), true, "inside the window");
  assert.equal(authenticatedRecently(at(RECENT_AUTH_WINDOW_MS), now), true, "exactly at the edge");
  assert.equal(authenticatedRecently(at(RECENT_AUTH_WINDOW_MS + 1), now), false, "one ms past");
  assert.equal(authenticatedRecently(at(24 * 60 * 60_000), now), false, "yesterday's session");

  /*
   * CLOCK SKEW MUST NOT READ AS FRESHNESS. A `createdAt` in the future makes a
   * bare `age <= WINDOW` true for any distance ahead — the check would pass
   * hardest exactly where the clocks are least trustworthy.
   */
  assert.equal(authenticatedRecently(at(-1_000), now), false, "one second in the future");
  assert.equal(authenticatedRecently(at(-999 * 60_000), now), false, "far future");

  // A window that drifts into hours silently turns "re-auth" into "signed in".
  assert.ok(RECENT_AUTH_WINDOW_MS <= 30 * 60_000, "the window must stay minutes, not hours");
});

test("session freshness measures AUTHENTICATION, not token refresh", () => {
  const sessions = src("modules/sessions/index.ts");
  const rotate = sessions.slice(sessions.indexOf("export async function rotateAuthSession"));
  const body = rotate.slice(0, rotate.indexOf("export async function", 10));

  /*
   * THE LOAD-BEARING ASSUMPTION. `authenticatedRecently` reads
   * `session.createdAt`, which only means "when a human last proved who they
   * were" for as long as rotation UPDATES the row instead of inserting one. If
   * rotation ever creates a new session, this check silently becomes "was a
   * token refreshed recently" and the recent-auth path stops being re-auth.
   */
  assert.match(body, /db\.session\.update\(/, "rotation must update the existing row");
  assert.doesNotMatch(body, /db\.session\.create\(/, "rotation must NOT create a new session row");

  // The freshness check reads session CREATION, and the route reaches it only
  // through that one helper.
  assert.match(src("lib/recentAuth.ts"), /session\.createdAt\.getTime\(\)/);
  assert.match(routes, /authenticatedRecently\(session\)/);
});

test("no password control routes to the session list", () => {
  /*
   * The original bug, asserted where it lived. /sessions is a page about
   * devices; sending someone there to manage a credential is how this went
   * unnoticed.
   */
  const consumerCards = read(join("..", "..", "..", "apps", "migrapilot-consumer", "src", "features", "settings", "cards.tsx"));

  for (const [label, haystack] of [["consumer settings", consumerCards], ["password page", page]] as const) {
    const offenders = [...haystack.matchAll(/href="([^"]*\/sessions[^"]*)"/g)]
      .filter((match) => {
        const line = haystack.slice(0, match.index).split("\n").length;
        const context = haystack.split("\n").slice(line - 6, line + 2).join("\n");
        return /password/i.test(context);
      });
    assert.equal(offenders.length, 0, `${label}: a password control still links to /sessions`);
  }

  // And both password affordances now name the real surface.
  assert.ok(consumerCards.includes("auth.migrateck.com/account/password"));
  assert.equal(
    (consumerCards.match(/auth\.migrateck\.com\/account\/password/g) ?? []).length,
    2,
    "both 'Manage password' and the last-sign-in-method 'Set a password' must point at it",
  );
});

test("the page states whether password sign-in is currently on", () => {
  /*
   * One of the four questions this surface did not answer. Asserted because a
   * form with no status reads as "you have no password" to someone who does.
   */
  assert.match(page, /Password sign-in/);
  assert.match(page, /facts\.has_password \? "On" : "Not set up"/);
  assert.match(page, /Ways to sign in/);
});

test("a settled load never still says 'loading'", () => {
  /*
   * CAUGHT IN A REAL BROWSER, not by a test. The heading and subtitle branched
   * on `facts === null`, which is true both while loading AND after a failed
   * load — so an unauthenticated visit rendered "Loading your account security
   * settings…" forever, directly above the message saying it had failed. A
   * spinner that never resolves tells someone to wait for something that is not
   * coming, which is worse than an error.
   */
  assert.match(page, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(page, /\} finally \{\s*setLoading\(false\);/, "loading must clear on BOTH paths");
  assert.match(page, /\{loading\s*\?\s*"Loading your account security settings/);
  // The failed-load message is not a dead end.
  assert.match(page, /loadNeedsSignIn \? \(/);
});

test("no raw API error can reach the user", () => {
  assert.match(page, /function describeFailure/);
  for (const code of ["reauthentication_required", "reauthentication_failed", "password_unchanged"]) {
    assert.ok(page.includes(`case "${code}"`), `${code} must have human copy`);
  }
  // A JSON-looking fallback is replaced rather than rendered.
  assert.match(page, /\/\^\[\{\[\]\/\.test\(fallback\)/);
});

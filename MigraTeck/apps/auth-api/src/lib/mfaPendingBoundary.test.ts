/**
 * The MFA-pending boundary.
 *
 * These pin the SHAPE of the fix rather than the database behaviour, because the
 * failure being guarded against is structural: the boundary was previously
 * absent from the query and present only in the routes' imagination, so an
 * unanswered challenge authorised `/v1/me`, `/v1/me/security` and `/v1/admin/*`.
 *
 * What must stay true:
 *   1. `validateSession` filters on `mfaPendingAt: null` — enforcement lives in
 *      the shared validator, so future routes inherit it without knowing MFA
 *      exists.
 *   2. Exactly ONE function can see a pending session, and exactly one route
 *      uses it.
 *   3. Promotion is conditional, so it cannot be replayed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relative: string) =>
  readFileSync(join(process.cwd(), "src", relative), "utf8");

test("validateSession refuses MFA-pending sessions in the query itself", () => {
  const sessions = read("modules/sessions/index.ts");
  const start = sessions.indexOf("export async function validateSession");
  assert.ok(start > 0, "validateSession must exist");
  const body = sessions.slice(start, start + 2000);

  /*
   * THE LOAD-BEARING ASSERTION. If this filter is ever removed, every guard in
   * the service silently starts accepting half-authenticated sessions again —
   * and nothing else in the codebase would fail.
   */
  assert.match(body, /mfaPendingAt:\s*null/, "validateSession must filter out pending sessions");
});

test("only the challenge path can see a pending session", () => {
  const sessions = read("modules/sessions/index.ts");
  assert.match(sessions, /export async function validatePendingSession/);

  const middleware = read("middleware/session.ts");
  // The pending validator is reachable from exactly one guard.
  const uses = middleware.split("validatePendingSession").length - 1;
  assert.equal(uses, 2, "imported once and called once, in requireMfaChallengeOrUser only");
  assert.match(middleware, /export async function requireMfaChallengeOrUser/);
});

test("the ordinary guards do NOT use the pending validator", () => {
  const middleware = read("middleware/session.ts");
  const guard = middleware.slice(
    middleware.indexOf("export async function requireAuthenticatedUser"),
    middleware.indexOf("export async function optionalSession"),
  );
  assert.ok(guard.length > 0);
  assert.equal(
    guard.includes("validatePendingSession"),
    false,
    "requireAuthenticatedUser must never admit a pending session",
  );
});

test("exactly one route admits the challenge guard", () => {
  const mfa = read("routes/mfa.ts");
  const occurrences = mfa.split("requireMfaChallengeOrUser").length - 1;
  // Once in the import, once on the verify route. Anything more means a second
  // endpoint became reachable by a half-authenticated session.
  assert.equal(occurrences, 2, "only /v1/mfa/totp/verify may use the challenge guard");
  assert.match(mfa, /"\/v1\/mfa\/totp\/verify",\s*\{\s*preHandler:\s*requireMfaChallengeOrUser/);
});

test("promotion is conditional and reports whether it happened", () => {
  const sessions = read("modules/sessions/index.ts");
  const start = sessions.indexOf("export async function promoteSessionAfterMfa");
  assert.ok(start > 0);
  const body = sessions.slice(start, start + 800);

  // updateMany + a row-count check: a promotion that matched nothing must not
  // read as success, or the caller hands back a session that still cannot be used.
  assert.match(body, /updateMany/);
  assert.match(body, /mfaPendingAt:\s*\{\s*not:\s*null\s*\}/);
  assert.match(body, /count\s*===\s*1/);
});

test("both login paths create the pre-challenge session as pending", () => {
  for (const file of ["routes/auth.ts", "routes/social.ts"]) {
    const source = read(file);
    if (!source.includes("hasTotpEnabled")) continue;
    assert.match(
      source,
      /createAuthSession\([^)]*\{\s*\n?\s*mfaPending:\s*true/s,
      `${file} must create its pre-challenge session as MFA-pending`,
    );
  }
});

test("a recovery code cannot confirm an enrolment", () => {
  /*
   * Confirming an enrolment has to prove the authenticator works. A recovery
   * code would enable a factor nobody had demonstrated they can produce — and
   * the codes were handed out by that same enrolment moments earlier.
   */
  const mfa = read("routes/mfa.ts");
  assert.match(mfa, /recovery_code_not_applicable/);
  assert.match(mfa, /if\s*\(!request\.mfaPending\)/);
});

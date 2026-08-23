/**
 * Where a provider sign-in may land.
 *
 * `return_to` is chosen before the browser leaves for the provider and used
 * after it returns, which makes it the classic open-redirect surface: an
 * attacker who can set it borrows this domain to send someone anywhere, and the
 * URL bar reads `auth.migrateck.com` right up until it does not.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env["AUTH_PUBLIC_URL"] = "https://auth.migrateck.com";
process.env["AUTH_WEB_URL"] = "https://auth.migrateck.com";
process.env["AUTH_SOCIAL_RETURN_ORIGINS"] = "https://chat.migrateck.com";

const { safeReturnTo, withOutcome } = await import("./redirect.js");

test("an allowlisted origin is accepted and normalized", () => {
  assert.equal(
    safeReturnTo("https://chat.migrateck.com/api/auth/callback?state=abc"),
    "https://chat.migrateck.com/api/auth/callback?state=abc",
  );
  assert.ok(safeReturnTo("https://auth.migrateck.com/authorize?client_id=x"));
});

test("a LOOKALIKE origin is refused — this is why it is not a prefix check", () => {
  /*
   * `https://auth.migrateck.com.evil.test` starts with the right string and is
   * a completely different site. Only comparing a parsed origin catches it.
   */
  for (const hostile of [
    "https://auth.migrateck.com.evil.test/steal",
    "https://chat.migrateck.com.evil.test/steal",
    "https://evil.test/?x=https://auth.migrateck.com",
    "https://auth.migrateck.com@evil.test/",
  ]) {
    assert.equal(safeReturnTo(hostile), null, `${hostile} must be refused`);
  }
});

test("a non-http scheme is refused", () => {
  for (const hostile of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"]) {
    assert.equal(safeReturnTo(hostile), null, hostile);
  }
});

test("a relative value is refused rather than resolved against a guess", () => {
  // A provider callback has no meaningful base, and guessing one is how a
  // path-relative value silently becomes a different origin.
  assert.equal(safeReturnTo("/authorize?client_id=x"), null);
  assert.equal(safeReturnTo("//evil.test/steal"), null);
});

test("absent, empty and absurd values are refused", () => {
  assert.equal(safeReturnTo(undefined), null);
  assert.equal(safeReturnTo(null), null);
  assert.equal(safeReturnTo(""), null);
  assert.equal(safeReturnTo(`https://chat.migrateck.com/${"x".repeat(3000)}`), null);
});

test("an outcome is ADDED to the destination, never rebuilt over it", () => {
  /*
   * The authorize URL a sign-in returns to carries the client's PKCE challenge
   * and state. Rebuilding the query would drop them and break the very flow
   * this is completing.
   */
  const out = withOutcome(
    "https://chat.migrateck.com/api/auth/callback?code_challenge=abc&state=xyz",
    { auth_error: "provider_cancelled" },
  );
  const url = new URL(out);
  assert.equal(url.searchParams.get("code_challenge"), "abc");
  assert.equal(url.searchParams.get("state"), "xyz");
  assert.equal(url.searchParams.get("auth_error"), "provider_cancelled");
});

/**
 * The account-security return destination.
 *
 * THIS IS A REDIRECT DECISION, so it is tested like one. The failure mode is an
 * open redirect reached from a page that just handled a credential, and the
 * inputs come from a registry row that a human types. Reading it carefully once
 * is not the same as proving it.
 *
 * The rule being pinned: a configured URL is honoured ONLY when its origin is one
 * the client already proved it owns at registration. Anything else is ignored —
 * never obeyed, never fatal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountReturn, ownedOrigins } from "./accountReturn.js";

const MIGRAPILOT = {
  defaultPostLoginUrl: null,
  redirectUris: ["https://chat.migrateck.com/api/auth/callback"],
};

test("a configured destination on an owned origin is honoured, path and all", () => {
  const out = resolveAccountReturn({
    ...MIGRAPILOT,
    accountReturnUrl: "https://chat.migrateck.com/api/auth/login?next=/settings",
  });
  assert.equal(out.reason, "configured");
  assert.equal(out.url, "https://chat.migrateck.com/api/auth/login?next=/settings");
});

test("an off-origin destination is IGNORED, not obeyed", () => {
  /*
   * The whole point. A mistyped or malicious row must not turn a password change
   * into a redirect to somebody else's host.
   */
  const out = resolveAccountReturn({
    ...MIGRAPILOT,
    accountReturnUrl: "https://chat.migrateck.com.evil.test/api/auth/login",
  });
  assert.equal(out.reason, "unowned_origin");
  assert.equal(out.url, "https://chat.migrateck.com", "must fall back to an owned origin");
});

test("origin matching is exact — a prefix is not ownership", () => {
  for (const hostile of [
    "https://chat.migrateck.com.attacker.test/",
    "https://notchat.migrateck.com/",
    "https://chat.migrateck.com@attacker.test/",
    "https://attacker.test/?x=https://chat.migrateck.com/",
  ]) {
    const out = resolveAccountReturn({ ...MIGRAPILOT, accountReturnUrl: hostile });
    assert.notEqual(out.reason, "configured", `${hostile} must not be honoured`);
    assert.equal(out.url, "https://chat.migrateck.com");
  }
});

test("a different port is a different origin", () => {
  const out = resolveAccountReturn({
    ...MIGRAPILOT,
    accountReturnUrl: "https://chat.migrateck.com:8443/api/auth/login",
  });
  assert.equal(out.reason, "unowned_origin");
});

test("non-http schemes are refused", () => {
  for (const scheme of [
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "file:///etc/passwd",
    "//chat.migrateck.com/api/auth/login",
    "not a url at all",
  ]) {
    const out = resolveAccountReturn({ ...MIGRAPILOT, accountReturnUrl: scheme });
    assert.notEqual(out.reason, "configured", `${scheme} must never be honoured`);
    assert.ok(out.url === null || out.url.startsWith("https://"), "only https may survive");
  }
});

test("plain http is refused except on localhost", () => {
  assert.notEqual(
    resolveAccountReturn({
      defaultPostLoginUrl: null,
      redirectUris: ["http://chat.migrateck.com/api/auth/callback"],
      accountReturnUrl: "http://chat.migrateck.com/api/auth/login",
    }).reason,
    "configured",
  );

  // Development stays workable.
  const local = resolveAccountReturn({
    defaultPostLoginUrl: null,
    redirectUris: ["http://localhost:3000/api/auth/callback"],
    accountReturnUrl: "http://localhost:3000/api/auth/login?next=/settings",
  });
  assert.equal(local.reason, "configured");
});

test("with nothing configured, the ORIGIN is used and never a callback path", () => {
  const out = resolveAccountReturn({ ...MIGRAPILOT, accountReturnUrl: null });
  assert.equal(out.reason, "origin_fallback");
  /*
   * A redirect URI's path is a callback that expects an authorization code. An
   * arriving visitor gets an error page, not a sign-in — so only the origin is
   * ever used.
   */
  assert.equal(out.url, "https://chat.migrateck.com");
  assert.ok(!out.url.includes("/callback"));
});

test("defaultPostLoginUrl is preferred over a redirect URI for the fallback", () => {
  const out = resolveAccountReturn({
    defaultPostLoginUrl: "https://migrahosting.com",
    redirectUris: ["https://vps.migrahosting.com/auth/callback"],
    accountReturnUrl: null,
  });
  assert.equal(out.url, "https://migrahosting.com");
});

test("a client with no usable destination resolves to nothing, not to a guess", () => {
  const out = resolveAccountReturn({
    defaultPostLoginUrl: null,
    redirectUris: [],
    accountReturnUrl: null,
  });
  assert.equal(out.url, null);
  assert.equal(out.reason, "none");
});

test("malformed registry rows are skipped, not fatal", () => {
  const facts = {
    defaultPostLoginUrl: "]]not a url[[",
    redirectUris: ["https://chat.migrateck.com/api/auth/callback", 42, null, { nope: true }],
    accountReturnUrl: null,
  };
  assert.doesNotThrow(() => resolveAccountReturn(facts));
  assert.deepEqual([...ownedOrigins(facts)], ["https://chat.migrateck.com"]);
});

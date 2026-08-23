/**
 * Which account a provider sign-in resolves to.
 *
 * Every dangerous outcome in external identity is SILENT: linking to the wrong
 * account looks exactly like a successful sign-in, and the victim finds out when
 * a stranger is reading their conversations. So the decision is a pure function,
 * and this enumerates its branches rather than trusting a live OAuth round trip
 * to happen to exercise them.
 *
 * The two takeover shapes this exists to refuse:
 *
 *   provider-side — someone puts a victim's address on a provider account they
 *   control and signs in, inheriting the MigraAuth account
 *
 *   MigraAuth-side — someone registers with an address they do not own and
 *   waits, inheriting the real owner's provider sign-in when it arrives
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decideLinking, type LinkingFacts } from "./linking.js";

const facts = (over: Partial<LinkingFacts> = {}): LinkingFacts => ({
  mode: "login",
  existingLinkUserId: null,
  providerEmail: null,
  providerEmailVerified: false,
  emailOwnerUserId: null,
  emailOwnerVerified: false,
  sessionUserId: null,
  sessionUserAlreadyLinkedProvider: false,
  ...over,
});

// ── signing in ──────────────────────────────────────────────────────────────

test("an existing link signs that user in, whatever the email now says", () => {
  /*
   * Checked BEFORE anything email-shaped, because the link was established by a
   * previous proof and provider addresses change. A person who changes their
   * Google address must still be themselves.
   */
  const decision = decideLinking(
    facts({
      existingLinkUserId: "user-1",
      providerEmail: "new-address@example.test",
      providerEmailVerified: true,
      emailOwnerUserId: "user-2",
      emailOwnerVerified: true,
    }),
  );
  assert.deepEqual(decision, { kind: "sign_in", userId: "user-1" });
});

test("a first-time provider account with no matching email creates an account", () => {
  assert.deepEqual(
    decideLinking(facts({ providerEmail: "new@example.test", providerEmailVerified: true })),
    { kind: "create_account" },
  );
});

test("a provider that reports no email at all still creates an account", () => {
  // GitHub with `user:email` declined. Legitimate: the account links, it just
  // cannot auto-match an existing one.
  assert.deepEqual(decideLinking(facts({ providerEmail: null })), { kind: "create_account" });
});

test("verified on BOTH sides links to the existing account", () => {
  assert.deepEqual(
    decideLinking(
      facts({
        providerEmail: "person@example.test",
        providerEmailVerified: true,
        emailOwnerUserId: "user-7",
        emailOwnerVerified: true,
      }),
    ),
    { kind: "link_and_sign_in", userId: "user-7" },
  );
});

// ── the refusals that matter ────────────────────────────────────────────────

test("an UNVERIFIED provider email never matches an existing account", () => {
  /*
   * The provider-side takeover. If this linked, anyone who can attach a
   * victim's address to a provider account they control inherits the victim's
   * MigraAuth account — and the victim sees nothing.
   */
  const decision = decideLinking(
    facts({
      providerEmail: "victim@example.test",
      providerEmailVerified: false,
      emailOwnerUserId: "victim-user",
      emailOwnerVerified: true,
    }),
  );
  assert.equal(decision.kind, "refuse");
  assert.equal((decision as { code: string }).code, "email_unverified_at_provider");
});

test("an UNVERIFIED MigraAuth account never absorbs a provider sign-in", () => {
  /*
   * The MigraAuth-side takeover. Someone registers with an address they do not
   * own and waits; without this, the real owner's Google sign-in hands them the
   * squatter's account — and the squatter keeps their password.
   */
  const decision = decideLinking(
    facts({
      providerEmail: "person@example.test",
      providerEmailVerified: true,
      emailOwnerUserId: "squatter",
      emailOwnerVerified: false,
    }),
  );
  assert.equal(decision.kind, "refuse");
  assert.equal((decision as { code: string }).code, "email_requires_password_login");
});

test("neither refusal creates a second account for the same address", () => {
  // The alternative to refusing is a duplicate: two accounts holding one
  // address, and no way to tell afterwards which one is the real owner.
  for (const over of [
    { providerEmailVerified: false, emailOwnerVerified: true },
    { providerEmailVerified: true, emailOwnerVerified: false },
    { providerEmailVerified: false, emailOwnerVerified: false },
  ]) {
    const decision = decideLinking(
      facts({ providerEmail: "person@example.test", emailOwnerUserId: "existing", ...over }),
    );
    assert.equal(decision.kind, "refuse", JSON.stringify(over));
  }
});

test("every refusal tells the person what to do next", () => {
  const decision = decideLinking(
    facts({
      providerEmail: "person@example.test",
      providerEmailVerified: true,
      emailOwnerUserId: "existing",
      emailOwnerVerified: false,
    }),
  );
  assert.equal(decision.kind, "refuse");
  // A refusal with no route forward is a dead end, and the route is always the
  // same one: the password, which only the real owner has.
  assert.match((decision as { message: string }).message, /password/i);
});

// ── linking from a signed-in session ────────────────────────────────────────

test("linking attaches the provider to the signed-in user", () => {
  assert.deepEqual(
    decideLinking(facts({ mode: "link", sessionUserId: "me" })),
    { kind: "link_to_session", userId: "me" },
  );
});

test("linking without a session is refused rather than guessed at", () => {
  const decision = decideLinking(facts({ mode: "link", sessionUserId: null }));
  assert.equal(decision.kind, "refuse");
  assert.equal((decision as { code: string }).code, "link_requires_session");
});

test("a provider account held by someone else is NEVER moved", () => {
  // Re-pointing it would take that person's sign-in away without telling them.
  const decision = decideLinking(
    facts({ mode: "link", sessionUserId: "me", existingLinkUserId: "someone-else" }),
  );
  assert.equal(decision.kind, "refuse");
  assert.equal((decision as { code: string }).code, "provider_account_linked_elsewhere");
});

test("re-linking the same account to the same user is idempotent, not an error", () => {
  // The user asked for a state that is already true.
  assert.deepEqual(
    decideLinking(facts({ mode: "link", sessionUserId: "me", existingLinkUserId: "me" })),
    { kind: "link_to_session", userId: "me" },
  );
});

test("a second account for the same provider on one user is refused", () => {
  // Ambiguous at sign-in: either link could resolve the session.
  const decision = decideLinking(
    facts({ mode: "link", sessionUserId: "me", sessionUserAlreadyLinkedProvider: true }),
  );
  assert.equal(decision.kind, "refuse");
  assert.equal((decision as { code: string }).code, "provider_already_linked_to_session_user");
});

test("linking never signs anybody in or creates anything", () => {
  // `link` mode runs against an already-authenticated session; producing a
  // sign-in or an account from it would be authenticating on the strength of a
  // request parameter.
  for (const over of [
    {},
    { existingLinkUserId: "me" },
    { providerEmail: "x@example.test", providerEmailVerified: true, emailOwnerUserId: "other", emailOwnerVerified: true },
  ]) {
    const decision = decideLinking(facts({ mode: "link", sessionUserId: "me", ...over }));
    assert.ok(
      decision.kind === "link_to_session" || decision.kind === "refuse",
      `link mode produced ${decision.kind}`,
    );
  }
});

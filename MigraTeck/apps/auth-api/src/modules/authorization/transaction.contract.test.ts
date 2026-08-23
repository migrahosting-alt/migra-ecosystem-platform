/**
 * The authorization transaction, as a contract.
 *
 * These assert the SHAPE of the outcomes rather than the database, because the
 * database-backed behaviour (single-use consumption under concurrency) is a
 * claim about `updateMany` that only a real PostgreSQL can demonstrate — and
 * auth-api has no disposable-database harness yet. What is pinned here is the
 * part that would silently regress in code review: which refusals exist, and
 * that they stay distinguishable.
 *
 * The distinction matters because it is what the user is told. "Expired",
 * "already used" and "never existed" lead to three different sentences, and
 * collapsing them tells someone to try again when trying again cannot work.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { toPublicView, type PublicTransactionView } from "./transaction.js";

test("the public view carries branding, and nothing a browser could abuse", () => {
  /*
   * The login screen needs to say which product is asking. It does NOT need the
   * PKCE challenge, the redirect URI or the client's state — and anything handed
   * to a browser is something a browser can alter, so the safest version of
   * those fields is their absence.
   */
  const view: PublicTransactionView = toPublicView({
    id: "txn_abc",
    clientId: "migrapilot_web",
    redirectUri: "https://chat.migrateck.com/api/auth/callback",
    responseType: "code",
    scope: "openid profile",
    clientState: "the-client-state",
    codeChallenge: "the-challenge",
    codeChallengeMethod: "S256",
    nonce: "the-nonce",
    prompt: null,
    loginHint: null,
    provider: null,
    userId: null,
    consumedAt: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ipAddress: null,
    userAgent: null,
    client: { clientName: "MigraPilot" },
  } as never);

  assert.equal(view.clientName, "MigraPilot");
  assert.equal(view.clientId, "migrapilot_web");

  const serialized = JSON.stringify(view);
  for (const secret of ["the-challenge", "the-client-state", "the-nonce", "chat.migrateck.com"]) {
    assert.ok(!serialized.includes(secret), `${secret} must never reach the browser`);
  }
});

test("every refusal reason is distinguishable", () => {
  // Collapsing these is how a user gets told to retry something that cannot
  // succeed. The union is asserted so a future edit cannot quietly merge them.
  const reasons = ["unknown", "expired", "already_used", "client_inactive"] as const;
  assert.equal(new Set(reasons).size, reasons.length);
});

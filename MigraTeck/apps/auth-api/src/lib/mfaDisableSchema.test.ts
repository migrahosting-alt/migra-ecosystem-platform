/**
 * What may authorise turning MFA off.
 *
 * The route decides WHICH credential matched; this file pins the shape that
 * decides whether any credential was offered at all. That boundary is worth its
 * own test because the failure it prevents is silent: if an empty body parsed,
 * the route's `if (body.password)` / `if (body.code)` branches would both be
 * skipped and the request would fall through with nothing having been checked.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mfaDisableSchema } from "./schemas.js";

test("an empty body cannot reach the route", () => {
  /*
   * THE ONE THAT MATTERS. Both credential fields are optional so a
   * provider-only account can use a code instead of a password — and optional
   * fields, without the refinement, make `{}` a valid disable request.
   */
  assert.equal(mfaDisableSchema.safeParse({}).success, false);
  assert.equal(mfaDisableSchema.safeParse({ password: undefined }).success, false);
  assert.equal(mfaDisableSchema.safeParse({ password: "", code: "" }).success, false);
});

test("either credential alone is enough to be considered", () => {
  // Considered, not accepted — the route still has to verify it.
  assert.equal(mfaDisableSchema.safeParse({ password: "correct horse" }).success, true);
  assert.equal(mfaDisableSchema.safeParse({ code: "123456" }).success, true);
});

test("a recovery code is not held to the six-digit TOTP shape", () => {
  /*
   * Recovery codes are longer and not numeric. Reusing the TOTP regex here
   * would have made them unparseable — and the account that most needs a
   * recovery code is the one that has lost its authenticator, so the failure
   * would land exactly where there is no second option left.
   */
  assert.equal(mfaDisableSchema.safeParse({ code: "7f3a-91bc-4de2-8a05" }).success, true);
});

test("an oversized credential is refused rather than passed to a comparison", () => {
  assert.equal(mfaDisableSchema.safeParse({ password: "x".repeat(129) }).success, false);
  assert.equal(mfaDisableSchema.safeParse({ code: "x".repeat(65) }).success, false);
});

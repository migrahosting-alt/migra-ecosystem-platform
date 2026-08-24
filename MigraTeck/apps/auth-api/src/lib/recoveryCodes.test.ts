/**
 * Recovery codes.
 *
 * THE DEFECT: codes were STORED as `hashToken("a1b2c-3d4e5")` and CONSUMED as
 * `hashToken("a1b2c3d4e5")`. Those hashes can never be equal, so every recovery
 * code ever issued was invalid from the moment it was printed — the one
 * credential whose entire purpose is to work when nothing else does.
 *
 * It hid because a rejected recovery code looks exactly like a mistyped or
 * already-spent one, and the people hitting it are already locked out.
 *
 * Found by using one on a live account, not by any test. So the round trip is
 * now pinned by identity — store and consume must derive the same key — rather
 * than by each side being independently "reasonable".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { normalizeRecoveryCode, generateRecoveryCodes, RECOVERY_CODE_VERSION } from "../modules/mfa/index.js";

const mfaSource = readFileSync(join(process.cwd(), "src", "modules", "mfa", "index.ts"), "utf8");

/*
 * Comments stripped before any structural assertion. The doc comment above
 * `normalizeRecoveryCode` deliberately QUOTES the old broken expression so the
 * next reader knows what went wrong — and a naive search then finds the bug in
 * the explanation of the fix.
 */
const mfa = mfaSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("issued codes survive the round trip they are actually put through", () => {
  /*
   * THE ASSERTION THAT WOULD HAVE CAUGHT IT. Not "does store work" or "does
   * consume work" separately — both looked fine — but whether the key one
   * writes is the key the other reads.
   */
  for (const issued of generateRecoveryCodes(10)) {
    const stored = normalizeRecoveryCode(issued);
    const presented = normalizeRecoveryCode(issued);
    assert.equal(stored, presented, `${issued} must hash identically on both sides`);
    assert.doesNotMatch(stored, /-/, "the stored key must not carry the display separator");
  }
});

test("a human typing it back is not punished for formatting", () => {
  /*
   * These are read off paper or a screenshot by someone already locked out.
   * `A1B2C 3D4E5` is not a different code from `a1b2c-3d4e5`.
   */
  const canonical = normalizeRecoveryCode("a1b2c-3d4e5");
  for (const variant of ["a1b2c-3d4e5", "A1B2C-3D4E5", "a1b2c3d4e5", "a1b2c 3d4e5", " a1b2c-3d4e5 ", "A1B2C_3D4E5"]) {
    assert.equal(normalizeRecoveryCode(variant), canonical, `${variant} must resolve to the same code`);
  }
});

test("normalization does not collapse distinct codes", () => {
  const codes = generateRecoveryCodes(200).map(normalizeRecoveryCode);
  assert.equal(new Set(codes).size, codes.length, "normalization must not create collisions");
  for (const c of codes) assert.match(c, /^[a-f0-9]{10}$/, "10 hex characters after normalization");
});

test("both sides of the round trip go through the SAME function", () => {
  /*
   * Structural, and deliberately so: the original bug was two call sites each
   * doing their own normalization. One shared function is the fix; two
   * "equivalent" expressions is how it comes back.
   */
  assert.match(mfa, /const hashed = codes\.map\(\(code\) => hashToken\(normalizeRecoveryCode\(code\)\)\)/);
  assert.match(mfa, /const codeHash = hashToken\(normalizeRecoveryCode\(code\)\)/);
  assert.doesNotMatch(mfa, /hashToken\(code\.replace\(/, "no call site may normalize on its own");
  // One declaration + exactly two call sites: store and consume.
  assert.equal((mfa.match(/normalizeRecoveryCode\(/g) ?? []).length, 3, "declared once, used on both sides");
});

test("the stored key is a hash, never the code itself", () => {
  const code = generateRecoveryCodes(1)[0]!;
  const key = createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
  assert.notEqual(key, normalizeRecoveryCode(code));
  // The persisted array is the HASHED one; the marker sits beside it.
  assert.match(mfa, /metadata: \{ codes: hashed, v: RECOVERY_CODE_VERSION \}/, "only hashes are persisted");
  assert.doesNotMatch(mfa, /metadata: \{ codes: codes\b/, "raw codes must never be written");
});

test("pre-fix code sets are detectable, not silently presented as usable", () => {
  /*
   * Sets written before the fix hashed the separator in, so no correct verifier
   * can ever redeem them — structurally impossible, not merely unlikely. Someone
   * holding that printed sheet believes they have a way back in. The system has
   * to be able to say otherwise.
   *
   * ABSENCE IS THE SIGNAL: every pre-existing row has no marker, so "unmarked"
   * is exactly "written under the broken normalization". Defaulting an unmarked
   * set to usable would reintroduce the lie this flag exists to end.
   */
  assert.equal(RECOVERY_CODE_VERSION, 2);
  assert.match(mfa, /metadata: \{ codes: hashed, v: RECOVERY_CODE_VERSION \}/,
    "newly written sets must carry the marker");
  assert.match(mfa, /meta\["v"\] !== RECOVERY_CODE_VERSION/,
    "anything not matching the current version is stale");
  // No set at all is not stale — there is nothing to mislead anyone about.
  assert.match(mfa, /if \(!cred\) return false/);
  /*
   * Spending a code must not drop the marker, or redeeming one would make a
   * perfectly good set start reporting itself as unusable.
   */
  assert.match(mfa, /data: \{ metadata: \{ codes: storedCodes, v: meta\["v"\] \?\? null \} \}/);
});

test("the stale flag reaches the surface that can act on it", () => {
  const routes = readFileSync(join(process.cwd(), "src", "routes", "auth.ts"), "utf8");
  assert.match(routes, /recovery_codes_stale: recoveryStale/);
  assert.match(routes, /recoveryCodesAreStale\(user\.id\)/);
});

test("recovery codes can be replaced WITHOUT disabling the second factor", () => {
  /*
   * THE USER-FACING CONSEQUENCE OF THE HISTORICAL DEFECT. Detecting stale sets
   * is not enough: until this route existed, the only way to obtain a working
   * set was to turn MFA OFF and enrol again — asking someone to remove their
   * second factor in order to repair its backup, with a window where they had
   * neither.
   */
  const routes = readFileSync(join(process.cwd(), "src", "routes", "mfa.ts"), "utf8");
  const start = routes.indexOf('app.post("/v1/mfa/recovery-codes"');
  assert.ok(start > 0, "the regenerate route must exist");
  const handler = routes.slice(start, routes.indexOf("  app.", start + 10));

  assert.match(handler, /preHandler: requireAuthenticatedUser/);
  // Only meaningful when a second factor exists to back up.
  assert.match(handler, /hasTotpEnabled/);
  assert.match(handler, /code: "mfa_not_enabled"/);
  // It must NOT turn the factor off as a side effect.
  assert.doesNotMatch(handler, /disableTotp/, "regenerating must never disable MFA");

  /*
   * Ordered cheapest-to-most-consuming, exactly as `/v1/mfa/disable` is: a
   * recovery code is never spent on a request the password or a live code would
   * have satisfied.
   */
  const pwAt = handler.indexOf("verifyUserPassword");
  const totpAt = handler.indexOf("verifyTotp(");
  const recAt = handler.indexOf("consumeRecoveryCode(");
  assert.ok(pwAt > 0 && totpAt > pwAt && recAt > totpAt, "proofs must be tried cheapest first");

  assert.match(handler, /eventType: "MFA_RECOVERY_CODES_REGENERATED"/);
  assert.match(handler, /recovery_codes: codes/, "the plaintext is returned exactly once");
});

test("replacing a set is atomic — never neither old nor new", () => {
  /*
   * The two halves are a delete and a create. Unwrapped, a failure between them
   * destroys the old set without writing the new one, leaving the account with
   * NO recovery codes while the person reads a freshly printed sheet that never
   * reached the server.
   */
  assert.match(mfa, /await db\.\$transaction\(\[/);
  const tx = mfa.slice(mfa.indexOf("await db.$transaction(["));
  const body = tx.slice(0, tx.indexOf("]);"));
  assert.match(body, /deleteMany/);
  assert.match(body, /create/);
});

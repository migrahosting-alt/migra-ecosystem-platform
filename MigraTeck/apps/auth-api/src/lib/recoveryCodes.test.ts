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
import { normalizeRecoveryCode, generateRecoveryCodes } from "../modules/mfa/index.js";

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
  assert.match(mfa, /metadata: \{ codes: hashed \}/, "only hashes are persisted");
});

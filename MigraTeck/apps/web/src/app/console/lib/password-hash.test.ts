import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatScryptHash,
  HASH_ALGORITHM,
  HASH_SEPARATOR,
  SCRYPT_KEYLEN,
  verifyScryptHash,
} from "./password-hash.ts";

/**
 * Documentation-to-parser regression tests.
 *
 * `auth.ts` documented hash generation as `scrypt$salt$hash` while its parser has always
 * split on ":". Anyone following the documented command produced a value that could never
 * validate, and the only symptom was a login that failed with no diagnostic.
 *
 * The first test does not restate the format — it EXTRACTS the command from the docstring,
 * RUNS it, and feeds the output to the real parser. Documentation and parser therefore
 * cannot drift apart again: editing either one alone fails the build.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH_SOURCE = readFileSync(join(HERE, "auth.ts"), "utf8");
const PASSWORD = "correct horse battery staple";

/** Pull the documented `node -e "..."` generator out of the auth.ts docstring. */
const documentedCommand = (): string => {
  // Must match the runnable generator, not the env-var line above it that merely cites
  // `node -e "..." scryptSync` as a placeholder. `randomBytes` only appears in the real one.
  const line = AUTH_SOURCE.split("\n").find(
    (l) => l.includes("node -e") && l.includes("randomBytes") && l.includes("console.log"),
  );
  assert.ok(line, "auth.ts must document a runnable password-hash generator");
  const m = /node -e "(.+)"/.exec(line!);
  assert.ok(m, `could not parse the documented command from: ${line}`);
  return m![1]!;
};

test("the DOCUMENTED command produces a hash the REAL parser accepts", () => {
  // The whole point of this file. If the docstring's separator, algorithm or key length
  // ever diverges from password-hash.ts, this fails.
  const script = documentedCommand();
  const stored = execFileSync(process.execPath, ["-e", script, PASSWORD], {
    encoding: "utf8",
  }).trim();

  assert.ok(stored.length > 0, "the documented command printed nothing");
  assert.equal(
    verifyScryptHash(PASSWORD, stored),
    true,
    `the documented command produced ${JSON.stringify(stored.slice(0, 24))}…, which the parser rejects`,
  );
  assert.equal(verifyScryptHash("the wrong password", stored), false);
});

test("the documented output has the exact shape the parser requires", () => {
  const script = documentedCommand();
  const stored = execFileSync(process.execPath, ["-e", script, PASSWORD], {
    encoding: "utf8",
  }).trim();

  const parts = stored.split(HASH_SEPARATOR);
  assert.equal(parts.length, 3, `expected 3 ${HASH_SEPARATOR}-separated fields, got ${parts.length}`);
  assert.equal(parts[0], HASH_ALGORITHM);
  assert.match(parts[1]!, /^[0-9a-f]+$/, "salt must be hex");
  assert.match(parts[2]!, /^[0-9a-f]+$/, "hash must be hex");
  assert.equal(
    Buffer.from(parts[2]!, "hex").length,
    SCRYPT_KEYLEN,
    "documented key length must match SCRYPT_KEYLEN",
  );
  // The historical defect, pinned directly: a `$` separator must never come back.
  assert.ok(!stored.includes("$"), "the documented command must not emit `$` separators");
});

test("formatScryptHash round-trips through the parser", () => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(PASSWORD, salt, SCRYPT_KEYLEN);
  const stored = formatScryptHash(salt.toString("hex"), hash.toString("hex"));
  assert.equal(verifyScryptHash(PASSWORD, stored), true);
});

test("verification fails closed on every malformed stored value, and never throws", () => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(PASSWORD, salt, SCRYPT_KEYLEN).toString("hex");
  const saltHex = salt.toString("hex");

  const malformed: Array<[string, string]> = [
    ["empty", ""],
    ["dollar separators (the old documented format)", `scrypt$${saltHex}$${hash}`],
    ["wrong algorithm", `pbkdf2:${saltHex}:${hash}`],
    ["too few fields", `scrypt:${saltHex}`],
    ["too many fields", `scrypt:${saltHex}:${hash}:extra`],
    ["non-hex salt", `scrypt:zzzz:${hash}`],
    ["non-hex hash", `scrypt:${saltHex}:zzzz`],
    ["truncated hash", `scrypt:${saltHex}:${hash.slice(0, 32)}`],
    ["no separators at all", "scrypt"],
  ];

  for (const [label, stored] of malformed) {
    assert.equal(verifyScryptHash(PASSWORD, stored), false, `must reject: ${label}`);
  }
});

test("a correct hash rejects the wrong password and accepts only the right one", () => {
  const salt = crypto.randomBytes(16);
  const stored = formatScryptHash(
    salt.toString("hex"),
    crypto.scryptSync(PASSWORD, salt, SCRYPT_KEYLEN).toString("hex"),
  );
  assert.equal(verifyScryptHash(PASSWORD, stored), true);
  for (const wrong of ["", " ", PASSWORD.toUpperCase(), `${PASSWORD} `, "correct horse battery stapl"]) {
    assert.equal(verifyScryptHash(wrong, stored), false, `must reject ${JSON.stringify(wrong)}`);
  }
});

test("the OTHER documented copy of the command agrees with the parser", () => {
  /**
   * canonical console/account/page.tsx shows operators the same rotation command in the UI,
   * and it already used the colon. That second copy is why the auth.ts defect went
   * unnoticed for so long: the screen was right and the code comment was wrong.
   *
   * Two documented copies is two drift risks, so both are pinned here.
   */
  const accountPage = readFileSync(join(HERE, "..", "account", "page.tsx"), "utf8");
  assert.match(accountPage, /scryptSync/, "account/page.tsx should still document rotation");
  assert.match(
    accountPage,
    /'scrypt:'\s*\+/,
    "the account page must document the colon-separated format",
  );
  assert.doesNotMatch(
    accountPage,
    /'scrypt\$'/,
    "the account page must never document `$` separators",
  );
});

test("the separator is a colon, and the reason is recorded", () => {
  // The value lives in env files and systemd units, where `$` is expanded by the shell.
  // That is why the format is not the more conventional `$`-delimited PHC string.
  assert.equal(HASH_SEPARATOR, ":");
  assert.match(AUTH_SOURCE, /COLON/i, "auth.ts must state the separator explicitly");
});

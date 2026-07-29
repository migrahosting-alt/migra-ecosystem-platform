import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Guard: the rejected mail_staff_user authentication design must not come back.
 *
 * The historical console shipped a SECOND staff credential store — a `mail_staff_user`
 * table in the migrapanel database, with its own password hashing and role vocabulary,
 * entirely parallel to auth-api's User/UserCredential/Session/OrganizationMember. It was
 * rejected on architectural grounds, not merely procedural ones, and the migration was
 * never applied.
 *
 * Every file whose only usable path went through that table was removed from this branch.
 * These tests fail if any of it returns — by reintroduction, by a partial copy, or by a
 * route quietly reappearing that authenticates against it.
 *
 * The historical source branches still hold the original code. This guard is about what may
 * ship, not about erasing history.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..", ".."); // src — scans the whole app, not just console
const CONSOLE_ROOT = join(SRC_ROOT, "app", "console");

/** Every source file under src/, so a reintroduction anywhere in the app is caught. */
const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|sql)$/.test(entry)) out.push(full);
  }
  return out;
};

// This file names the very identifiers it forbids, so it must not scan itself.
const SELF = fileURLToPath(import.meta.url);
const ALL_SOURCES = sourceFiles(SRC_ROOT).filter((f) => f !== SELF);
const read = (f: string) => execFileSync("cat", [f], { encoding: "utf8" });

test("no source file references the rejected mail_staff_user table", () => {
  const offenders = ALL_SOURCES.filter((f) => read(f).includes("mail_staff_user"));
  assert.deepEqual(
    offenders.map((f) => relative(SRC_ROOT, f)),
    [],
    "mail_staff_user was rejected as a second staff credential store; see " +
      "scratchpad/db-compatibility-mail-staff-user-20260729.md",
  );
});

test("the mail-identity module and its migration are absent", () => {
  for (const p of [
    join(CONSOLE_ROOT, "lib", "mail-identity.ts"),
    join(CONSOLE_ROOT, "sql", "001_mail_staff_user.sql"),
  ]) {
    assert.equal(existsSync(p), false, `${relative(SRC_ROOT, p)} must not be reintroduced`);
  }
});

test("nothing imports mail-identity, and its auth functions do not exist", () => {
  for (const f of ALL_SOURCES) {
    const src = read(f);
    const where = relative(SRC_ROOT, f);
    assert.ok(!src.includes("mail-identity"), `${where} imports the removed mail-identity module`);
    // The two functions that read the rejected table, by name, in case the module is
    // reconstructed under a different filename.
    assert.ok(!src.includes("resolveStaffIdentity"), `${where} references resolveStaffIdentity`);
    assert.ok(!src.includes("verifyStaffPassword"), `${where} references verifyStaffPassword`);
  }
});

test("no console/mail route exists — the module is absent, not silently broken", () => {
  // Rule 5: a withheld route must be absent or return a controlled unsupported response.
  // This branch chose absent, matching canonical, which has no console/mail files at all.
  assert.equal(existsSync(join(CONSOLE_ROOT, "mail")), false, "console/mail must not exist");
});

test("constant-time comparison happens in exactly two known places", () => {
  // A new timingSafeEqual call site means a new credential or token path. The two allowed
  // ones are password-hash.ts (the env-admin password) and auth.ts (session-cookie HMAC).
  // Matching on the CALL, not the word, so documentation prose is not swept up —
  // console/account/page.tsx describes the hash command in text and is legitimately silent
  // here.
  const callers = ALL_SOURCES.filter((f) => /crypto\.timingSafeEqual\(/.test(read(f)));
  assert.deepEqual(
    callers.map((f) => relative(SRC_ROOT, f)).sort(),
    ["app/console/lib/auth.ts", "app/console/lib/password-hash.ts"],
    "a new constant-time comparison means a new credential path — justify it explicitly",
  );
});

test("no direct-database credential lookup remains in the console", () => {
  // Rule 3: no fallback credentials, no temporary direct-database authentication.
  // `password_hash` is the column name the rejected store used; the console must never
  // select a credential column from any database.
  const offenders = ALL_SOURCES.filter((f) => /password_hash/.test(read(f)));
  assert.deepEqual(
    offenders.map((f) => relative(SRC_ROOT, f)),
    [],
    "the console must not read credential columns; auth-api owns credential storage",
  );
});

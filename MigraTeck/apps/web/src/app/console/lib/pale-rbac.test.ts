import assert from "node:assert/strict";
import test from "node:test";
import {
  canBanAccounts,
  canRestoreAccounts,
  canSuspendAccounts,
  canViewAccounts,
  maskEmail,
  paleApiRoleFor,
  type PaleRole,
} from "./pale-rbac.ts";

/**
 * Negative tests for the console-side account-controls gate.
 *
 * This gate is deliberately STRICTER than pale-api's RolesGuard: pale-api permits any
 * moderation role to suspend/ban/restore, while here a moderator may only SUSPEND and
 * ban/restore require trust_safety_manager or above. These tests pin that asymmetry so a
 * future change cannot quietly relax the console to match the looser backend — the direction
 * the reconciliation instruction explicitly forbids.
 *
 * The console gate is NOT a security boundary. pale-api's RolesGuard is the enforcement
 * authority; this only decides what the UI offers. A test passing here says the button is
 * hidden, never that the action is impossible.
 */

const ALL_ROLES: PaleRole[] = [
  "owner",
  "admin",
  "trust_safety_manager",
  "moderator",
  "auditor",
];

test("null role is refused by every gate — unauthenticated is never privileged", () => {
  // The most important negative case: an absent role must fail closed everywhere.
  assert.equal(canViewAccounts(null), false);
  assert.equal(canSuspendAccounts(null), false);
  assert.equal(canBanAccounts(null), false);
  assert.equal(canRestoreAccounts(null), false);
});

test("an unknown role string is refused by every gate", () => {
  // Roles arrive from outside this module; an unrecognised value must not pass.
  const bogus = "superuser" as unknown as PaleRole;
  assert.equal(canViewAccounts(bogus), false);
  assert.equal(canSuspendAccounts(bogus), false);
  assert.equal(canBanAccounts(bogus), false);
  assert.equal(canRestoreAccounts(bogus), false);
});

test("auditor is view-only — refused suspend, ban and restore", () => {
  assert.equal(canViewAccounts("auditor"), true);
  assert.equal(canSuspendAccounts("auditor"), false);
  assert.equal(canBanAccounts("auditor"), false);
  assert.equal(canRestoreAccounts("auditor"), false);
});

test("moderator may suspend but NOT ban or restore — the console is stricter than pale-api", () => {
  // pale-api lets any moderation role ban/restore. The console withholds both.
  assert.equal(canViewAccounts("moderator"), true);
  assert.equal(canSuspendAccounts("moderator"), true);
  assert.equal(canBanAccounts("moderator"), false, "moderator must not be able to ban");
  assert.equal(canRestoreAccounts("moderator"), false, "moderator must not be able to restore");
});

test("ban and restore require trust_safety_manager or above", () => {
  for (const role of ["owner", "admin", "trust_safety_manager"] as PaleRole[]) {
    assert.equal(canBanAccounts(role), true, `${role} should ban`);
    assert.equal(canRestoreAccounts(role), true, `${role} should restore`);
  }
  for (const role of ["moderator", "auditor"] as PaleRole[]) {
    assert.equal(canBanAccounts(role), false, `${role} must not ban`);
    assert.equal(canRestoreAccounts(role), false, `${role} must not restore`);
  }
});

test("privilege is monotonic — no role may act without also being able to view", () => {
  // A role that can mutate but cannot view would be an incoherent gate.
  for (const role of ALL_ROLES) {
    if (canSuspendAccounts(role) || canBanAccounts(role) || canRestoreAccounts(role)) {
      assert.equal(canViewAccounts(role), true, `${role} can act but cannot view`);
    }
  }
});

test("ban/restore permission is a strict subset of suspend permission", () => {
  for (const role of ALL_ROLES) {
    if (canBanAccounts(role)) {
      assert.equal(canSuspendAccounts(role), true, `${role} can ban but not suspend`);
    }
  }
  const suspenders = ALL_ROLES.filter(canSuspendAccounts);
  const banners = ALL_ROLES.filter(canBanAccounts);
  assert.ok(banners.length < suspenders.length, "ban must be strictly narrower than suspend");
});

test("maskEmail never returns a full address, and rejects malformed input", () => {
  // Cross-tenant leakage guard: console operators see masked addresses, so the mask must not
  // fall back to the raw value on anything it fails to parse.
  assert.equal(maskEmail("alice@example.com"), "al•••@example.com");
  for (const bad of [null, undefined, "", "   ", "noatsign", "@leading.com", "trailing@"]) {
    assert.equal(maskEmail(bad), null, `must not pass through: ${JSON.stringify(bad)}`);
  }
  const masked = maskEmail("verylongaddress@example.com");
  assert.ok(masked !== null && !masked.includes("verylongaddress"), "local part must not survive");
});

test("paleApiRoleFor yields a mutation role ONLY for roles that may mutate", () => {
  // The bridge header carries this to pale-api. `null` is the fail-closed answer for a
  // view-only role — it must not be widened into a real role, and a mutation-capable role
  // must not silently degrade to null (which would look unauthenticated to the backend).
  for (const role of ALL_ROLES) {
    const mapped = paleApiRoleFor(role);
    if (canSuspendAccounts(role)) {
      assert.ok(
        typeof mapped === "string" && mapped.length > 0,
        `${role} may mutate but maps to ${JSON.stringify(mapped)}`,
      );
    } else {
      assert.equal(mapped, null, `view-only ${role} must map to null, got ${JSON.stringify(mapped)}`);
    }
  }
});

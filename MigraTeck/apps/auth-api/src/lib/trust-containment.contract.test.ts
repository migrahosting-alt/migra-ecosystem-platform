import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { permissionsForRoles } from "../modules/authorization/platformRoles.js";

const src = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");
const admin = src("routes/admin.ts");
const sessions = src("modules/sessions/index.ts");
const users = src("modules/users/index.ts");

test("session containment is separate from read authority", () => {
  const support = permissionsForRoles(["SUPPORT"]);
  const operator = permissionsForRoles(["OPERATOR"]);
  const owner = permissionsForRoles(["OWNER"]);

  assert.ok(!support.has("platform.users.sessions.manage"));
  assert.ok(operator.has("platform.users.sessions.manage"));
  assert.ok(owner.has("platform.users.sessions.manage"));
});

test("operator session routes are permission-gated and audited", () => {
  for (const path of [
    "/v1/admin/users/:id/sessions/:sessionId/revoke",
    "/v1/admin/users/:id/sessions/revoke-all",
  ]) {
    const at = admin.indexOf(path);
    assert.ok(at > 0, path + " must exist");
    const window = admin.slice(at, at + 900);
    assert.match(window, /platform\.users\.sessions\.manage/);
    assert.match(window, /adminActionSchema\.parse\(request\.body\)/);
  }

  assert.match(admin, /eventType: "ADMIN_SESSION_REVOKED"/);
  assert.match(admin, /eventType: "ADMIN_SESSIONS_REVOKED"/);
  assert.match(admin, /targetUserId: id/);
  assert.match(admin, /reason/);
});

test("single-session containment verifies session ownership inside the transaction", () => {
  const at = sessions.indexOf("export async function revokeUserSessionForOperator");
  const body = sessions.slice(at, at + 1800);
  assert.match(body, /db\.\$transaction/);
  assert.match(body, /id: sessionId/);
  assert.match(body, /userId/);
  assert.match(body, /deviceId: sessionId/);
  assert.match(body, /oAuthRefreshToken\.updateMany/);
});

test("all-session containment revokes sessions and refresh tokens atomically", () => {
  const at = sessions.indexOf("export async function revokeAllUserAccessForOperator");
  const body = sessions.slice(at, at + 1400);
  assert.match(body, /db\.\$transaction/);
  assert.match(body, /session\.updateMany/);
  assert.match(body, /oAuthRefreshToken\.updateMany/);
  assert.match(body, /revokedSessions: sessions\.count/);
  assert.match(body, /revokedRefreshTokens: refreshTokens\.count/);
});

test("lock and disable are containment operations, not status-only writes", () => {
  for (const fn of ["lockUserWithContainment", "disableUserWithContainment"]) {
    assert.ok(users.includes("export async function " + fn), fn + " must exist");
  }
  const containAt = users.indexOf("async function containUserWithStatus");
  const body = users.slice(containAt, containAt + 1800);
  assert.match(body, /db\.\$transaction/);
  assert.match(body, /tx\.user\.update/);
  assert.match(body, /tx\.session\.updateMany/);
  assert.match(body, /tx\.oAuthRefreshToken\.updateMany/);

  assert.match(admin, /lockUserWithContainment\(id\)/);
  assert.match(admin, /disableUserWithContainment\(id\)/);
  assert.match(admin, /revoked_sessions: containment\.revokedSessions/);
  assert.match(admin, /revoked_refresh_tokens: containment\.revokedRefreshTokens/);
});

test("platform OWNER accounts cannot be neutralized by ordinary operators", () => {
  const at = admin.indexOf("async function containmentBlockReason");
  const body = admin.slice(at, at + 1800);
  assert.match(body, /targetRoles\.includes\("OWNER"\)/);
  assert.match(body, /platform\.roles\.manage/);
  assert.match(body, /user: \{ status: "ACTIVE" \}/);
  assert.match(body, /last active platform OWNER/);
});

test("admin MFA reset requires a reason and inherits OWNER protection", () => {
  const at = admin.indexOf('"/v1/admin/users/:id/mfa/reset"');
  const body = admin.slice(at, at + 1800);
  assert.match(body, /adminActionSchema\.parse\(request\.body\)/);
  assert.match(body, /containmentBlockReason\(request, id/);
  assert.match(body, /eventData: \{ had_totp: hadTotp, reason \}/);
});

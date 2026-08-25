/**
 * Platform operator authority.
 *
 * WHAT THIS REPLACES: `AUTH_ADMIN_USER_IDS`, an env allowlist that could not
 * record who granted access or when, could not be revoked without a deploy, and
 * was edited by whoever could edit a unit file.
 *
 * The parts that fail SILENTLY, and are therefore pinned here:
 *   1. Deny by default — no grant means nothing, never everything.
 *   2. Roles are bundles over permissions; guards ask for permissions.
 *   3. SUPPORT cannot suspend accounts, and only OWNER can grant authority.
 *   4. The bootstrap env path is a FALLBACK, never a parallel path, and every
 *      use of it is reported.
 *   5. The last OWNER cannot be revoked.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { permissionsForRoles, PLATFORM_PERMISSIONS } from "../modules/authorization/platformRoles.js";

const src = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");
/*
 * Comments stripped before structural scanning. These files deliberately QUOTE
 * the anti-patterns they avoid — the guard's own doc says why it does not check
 * `role === "owner"`, and the module says authority is "never cached". A naive
 * search then finds the defect inside the explanation of the fix.
 */
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const module_ = src("modules/authorization/platformRoles.ts");
const guard = src("middleware/session.ts");
const guardCode = code("middleware/session.ts");
const admin = src("routes/admin.ts");
const adminCode = code("routes/admin.ts");
const moduleCode = code("modules/authorization/platformRoles.ts");

test("no roles grants nothing at all", () => {
  /*
   * THE FAILURE MODE THAT MATTERS. This surface was once reachable by anyone
   * signed in. A misconfigured deployment must land on "no one is an operator",
   * never "everyone is".
   */
  assert.equal(permissionsForRoles([]).size, 0);
});

test("SUPPORT can read but cannot change anything", () => {
  const p = permissionsForRoles(["SUPPORT"]);
  assert.ok(p.has("platform.users.read"));
  assert.ok(p.has("platform.audit.read"));
  assert.ok(!p.has("platform.users.suspend"), "support must not be able to disable accounts");
  assert.ok(!p.has("platform.roles.manage"), "support must not be able to widen access");
});

test("identifying yourself does not require power over other people", () => {
  /*
   * `/v1/admin/me` was guarded by `platform.users.read`, which coupled "who am
   * I" to "enumerate everyone". A narrow model-operator holding only
   * `platform.models.qualify` could then never discover its own identity — and
   * the operator tool must derive its approver from exactly that endpoint.
   */
  for (const role of ["SUPPORT", "OPERATOR", "OWNER"] as const) {
    assert.ok(permissionsForRoles([role]).has("platform.self.read"), `${role} must be able to identify itself`);
  }
  const me = admin.indexOf('"/v1/admin/me"');
  assert.match(admin.slice(me, me + 200), /requirePermission\("platform\.self\.read"\)/);
  // And it must return a canonical id, or the tool has nothing to derive from.
  assert.match(admin.slice(me, me + 1200), /user_id: user\.id/);
});

test("qualifying a model is a distinct power from granting roles", () => {
  /*
   * Different powers over different things: one decides WHO may operate the
   * platform, the other decides WHICH MODEL may answer users. An operator who
   * should be able to qualify a vision model does not thereby need the ability
   * to grant themselves ownership, and the reverse is equally true.
   */
  const support = permissionsForRoles(["SUPPORT"]);
  const operator = permissionsForRoles(["OPERATOR"]);
  const owner = permissionsForRoles(["OWNER"]);

  assert.ok(!support.has("platform.models.qualify"), "support must not approve models");
  assert.ok(!operator.has("platform.models.qualify"), "account operations are not model governance");
  assert.ok(owner.has("platform.models.qualify"));
  // And it is genuinely separate from roles.manage rather than an alias for it.
  assert.ok(PLATFORM_PERMISSIONS.includes("platform.models.qualify"));
  assert.notEqual("platform.models.qualify", "platform.roles.manage");
});

test("OPERATOR can act on accounts but cannot widen authority", () => {
  const p = permissionsForRoles(["OPERATOR"]);
  assert.ok(p.has("platform.users.suspend"));
  assert.ok(p.has("platform.clients.read"));
  /*
   * The separation the whole taxonomy exists for. An operator who can grant
   * themselves OWNER is an owner with extra steps.
   */
  assert.ok(!p.has("platform.roles.manage"), "only OWNER may grant roles");
});

test("OWNER holds every permission, including future ones", () => {
  const p = permissionsForRoles(["OWNER"]);
  for (const perm of PLATFORM_PERMISSIONS) {
    assert.ok(p.has(perm), `OWNER must hold ${perm}`);
  }
  assert.equal(p.size, PLATFORM_PERMISSIONS.length);
});

test("holding several roles unions their permissions", () => {
  const p = permissionsForRoles(["SUPPORT", "OPERATOR"]);
  assert.ok(p.has("platform.users.suspend"), "the stronger role must still apply");
  assert.ok(p.has("platform.audit.read"));
  assert.ok(!p.has("platform.roles.manage"), "union must not invent authority neither role has");
});

test("guards ask for a PERMISSION, never a role", () => {
  /*
   * A guard that checked `role === "owner"` would scatter the taxonomy across
   * handlers, so re-cutting the bundles later would mean auditing every route
   * for the ones that quietly disagree.
   */
  assert.match(guard, /export function requirePermission\(permission: PlatformPermission\)/);
  assert.doesNotMatch(guardCode, /role === ["']/, "no route-level role comparisons");
  assert.doesNotMatch(adminCode, /role === ["']/);
});

test("every admin route names its own permission — none inherits a blanket hook", () => {
  /*
   * One blanket `addHook` meant anyone who could READ a user could also DISABLE
   * one, which is the wrong shape for support work. It also meant a route added
   * later silently inherited operator authority; without it, an unguarded route
   * fails closed instead.
   */
  assert.doesNotMatch(adminCode, /addHook\("preHandler"/, "no blanket authorization hook");
  const routes = [...admin.matchAll(/app\.(get|post|delete)<?[^(]*\(\s*"(\/v1\/admin[^"]*)"/g)];
  assert.ok(routes.length >= 8, `expected the admin surface, found ${routes.length}`);
  for (const m of routes) {
    const at = admin.indexOf(m[0]);
    const window = admin.slice(at, at + 260);
    assert.match(window, /requirePermission\("platform\./, `${m[2]} must name a permission`);
  }
});

test("suspension and reading are different permissions", () => {
  for (const path of ["/lock", "/unlock", "/disable"]) {
    const at = admin.indexOf(`"/v1/admin/users/:id${path}"`);
    assert.ok(at > 0, `${path} route must exist`);
    assert.match(admin.slice(at, at + 200), /requirePermission\("platform\.users\.suspend"\)/);
  }
  const readAt = admin.indexOf('"/v1/admin/users"');
  assert.match(admin.slice(readAt, readAt + 200), /requirePermission\("platform\.users\.read"\)/);
});

test("the bootstrap env path is a fallback, not a parallel path", () => {
  /*
   * It is consulted ONLY when the user holds no live grants. If it were checked
   * first, or merged in, the env var would keep deciding after real grants
   * existed — and deleting it would silently change who is an operator.
   */
  const fn = module_.slice(module_.indexOf("export async function authorityForUser"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  const rolesAt = body.indexOf("const roles = await rolesForUser");
  const earlyReturn = body.indexOf("if (roles.length > 0)");
  const bootstrapAt = body.indexOf("bootstrapUserIds()");
  assert.ok(rolesAt >= 0 && earlyReturn > rolesAt, "grants must be read first");
  assert.ok(bootstrapAt > earlyReturn, "bootstrap must be consulted only after grants find nothing");
  assert.match(body, /viaBootstrap: true/);
  // And it must still deny when neither applies.
  assert.match(body, /permissions: new Set\(\)/);
});

test("every use of bootstrap authority is recorded", () => {
  /*
   * This is what stops a temporary path becoming permanent: the timeline shows
   * exactly how long the platform ran on an env var instead of real grants.
   */
  assert.match(guard, /if \(authority\.viaBootstrap\)/);
  assert.match(guard, /eventType: "ADMIN_BOOTSTRAP_AUTHORITY_USED"/);
  const audit = src("modules/audit/index.ts");
  assert.ok(audit.includes('"ADMIN_BOOTSTRAP_AUTHORITY_USED"'), "must reach the auth timeline");
});

test("the last OWNER cannot be revoked", () => {
  /*
   * `roles.manage` is held only by OWNER, so revoking the final one leaves a
   * platform nobody can administer — recoverable only by editing the database
   * by hand, which is the situation this table exists to end.
   */
  const fn = module_.slice(module_.indexOf("export async function revokeRole"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /input\.role === "OWNER"/);
  assert.match(body, /owners <= 1/);
  assert.match(body, /code: "last_owner"/);
  // Conditional revoke: two concurrent revocations must not both report success.
  assert.match(body, /updateMany/);
  assert.match(body, /revoked\.count !== 1/);
});

test("revocation preserves history rather than deleting it", () => {
  /*
   * "Who could do this on the day it happened" must stay answerable. A deleted
   * row cannot answer it.
   */
  assert.doesNotMatch(module_, /platformRoleGrant\.delete/, "grants must never be deleted");
  assert.match(module_, /revokedAt: new Date\(\)/);
  assert.match(module_, /revokedByUserId: input\.revokedByUserId/);
});

test("authority is resolved per request, never cached", () => {
  /*
   * A revocation that takes effect at the next deploy is not a revocation. The
   * moment you revoke someone's access is usually the moment it matters most.
   */
  const fn = module_.slice(module_.indexOf("export async function rolesForUser"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /revokedAt: null/, "only live grants count");
  assert.doesNotMatch(moduleCode, /cache|memo|ttl/i, "no caching layer on authority");
});

test("granting and revoking are audited with actor and subject", () => {
  for (const evt of ["PLATFORM_ROLE_GRANTED", "PLATFORM_ROLE_REVOKED"]) {
    assert.ok(admin.includes(`eventType: "${evt}"`), `${evt} must be audited`);
  }
  const grantAt = admin.indexOf('eventType: "PLATFORM_ROLE_GRANTED"');
  const window = admin.slice(grantAt - 400, grantAt + 200);
  assert.match(window, /actorUserId: actor\.id/);
  assert.match(window, /targetUserId: body\.user_id/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8");

const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/015_workforce_identity_control_plane.sql",
);
const provisioningMigration = read(
  "prisma/migrations/016_workforce_provisioning_outbox.sql",
);
const provisioningLeaseMigration = read(
  "prisma/migrations/017_workforce_provisioning_leases.sql",
);
const workforce = read("src/modules/workforce/index.ts");
const provisioningOutbox = read(
  "src/modules/workforce/provisioning-outbox.ts",
);
const provisioningDispatcher = read(
  "src/modules/workforce/provisioning-dispatcher.ts",
);
const routes = read("src/routes/workforce.ts");
const server = read("src/server.ts");
const auth = read("src/routes/auth.ts");

test("workforce uses one canonical MigraAuth user and an immutable cross-product Staff ID", () => {
  assert.match(schema, /model WorkforceProfile\s*\{/);
  assert.match(schema, /userId\s+String\s+@unique/);
  assert.match(schema, /staffId\s+String\s+@unique/);
  assert.match(schema, /@relation\("WorkforceProfileSubject"/);
  assert.match(workforce, /mt_staff_/);
  assert.doesNotMatch(routes, /staffId\s*=|staff_id.*update/i);
});

test("live product roles are append-only and concurrency-safe", () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS workforce_product_access_live_unique_idx[\s\S]*WHERE revoked_at IS NULL/,
  );
  assert.match(workforce, /revokedAt:\s*now/);
  assert.match(workforce, /revision:\s*\{ increment: 1 \}/);
  assert.doesNotMatch(workforce, /workforceProductAccessGrant\.delete/);
});

test("durable workforce provisioning has a real migration and worker wiring", () => {
  assert.match(schema, /model WorkforceProvisioningOutbox\s*\{/);
  assert.match(
    provisioningMigration,
    /CREATE TABLE IF NOT EXISTS workforce_provisioning_outbox/,
  );
  assert.match(
    provisioningMigration,
    /workforce_profile_id UUID NOT NULL[\s\S]*REFERENCES workforce_profiles\(id\)/,
  );
  assert.match(
    provisioningMigration,
    /entitlement_revision INTEGER NOT NULL/,
  );
  assert.match(
    provisioningMigration,
    /workforce_provisioning_outbox_product_delivery_idx/,
  );
  assert.match(provisioningOutbox, /workforceProvisioningOutbox\.create/);
  assert.match(
    provisioningDispatcher,
    /dispatchPendingWorkforceProvisioning/,
  );
  assert.match(
    provisioningDispatcher,
    /new jose\.SignJWT/,
  );
  assert.match(server, /startWorkforceProvisioningWorker/);
});

test("disabled workforce provisioning schedules no worker or expiry reconciliation", () => {
  const start = provisioningDispatcher.slice(
    provisioningDispatcher.indexOf(
      "export function startWorkforceProvisioningWorker",
    ),
  );
  const disabled = start.slice(0, start.indexOf("let stopped = false"));
  assert.match(disabled, /if \(!config\.workforceProvisioning\.enabled\)/);
  assert.match(disabled, /return \(\) => \{\};/);
  assert.doesNotMatch(disabled, /reconcileExpiredWorkforceProductAccess\(\)/);
  assert.doesNotMatch(disabled, /setInterval\(/);
});

test("workforce provisioning coordinates horizontally scaled dispatchers with crash-safe leases", () => {
  assert.match(schema, /leaseOwner\s+String\?\s+@map\("lease_owner"\)/);
  assert.match(
    schema,
    /leaseExpiresAt\s+DateTime\?\s+@map\("lease_expires_at"\)/,
  );
  assert.match(provisioningLeaseMigration, /ADD COLUMN IF NOT EXISTS lease_owner/);
  assert.match(
    provisioningLeaseMigration,
    /ADD COLUMN IF NOT EXISTS lease_expires_at/,
  );
  assert.match(
    provisioningLeaseMigration,
    /workforce_provisioning_outbox_claim_idx/,
  );

  assert.match(
    provisioningDispatcher,
    /claimPendingWorkforceProvisioning/,
  );
  assert.match(
    provisioningDispatcher,
    /leaseExpiresAt:\s*\{ lte: now \}/,
  );
  assert.match(
    provisioningDispatcher,
    /leaseOwner:\s*WORKER_ID/,
  );
  assert.match(
    provisioningDispatcher,
    /leaseOwner:\s*event\.leaseOwner/,
  );
  assert.match(
    provisioningDispatcher,
    /leaseOwner:\s*null,[\s\S]*leaseExpiresAt:\s*null/,
  );
});

test("workforce entitlement revision is monotonic across every authority mutation", () => {
  assert.match(
    schema,
    /entitlementRevision\s+Int\s+@default\(1\)\s+@map\("entitlement_revision"\)/,
  );
  assert.match(
    migration,
    /entitlement_revision INTEGER NOT NULL DEFAULT 1/,
  );

  const grant = workforce.slice(
    workforce.indexOf("export async function grantWorkforceProductAccess"),
    workforce.indexOf("export async function revokeWorkforceProductAccess"),
  );
  const revoke = workforce.slice(
    workforce.indexOf("export async function revokeWorkforceProductAccess"),
    workforce.indexOf("export async function terminateWorkforceIdentity"),
  );
  const terminate = workforce.slice(
    workforce.indexOf("export async function terminateWorkforceIdentity"),
    workforce.indexOf("export async function workforceProductContextByUserId"),
  );
  const context = workforce.slice(
    workforce.indexOf("export async function workforceProductContextByUserId"),
  );

  for (const mutation of [grant, revoke, terminate, context]) {
    assert.match(
      mutation,
      /entitlementRevision:\s*\{ increment: 1 \}/,
      "every effective authority mutation must advance the profile-level revision",
    );
  }

  assert.match(context, /WORKFORCE_PRODUCT_ACCESS_EXPIRED/);
  assert.match(context, /actorType:\s*"SYSTEM"/);
  assert.match(context, /revokedAt:\s*now/);
  assert.doesNotMatch(context, /Math\.max\(/);
  assert.doesNotMatch(workforce, /workforceProductContextByEmail/);
  assert.match(
    routes,
    /entitlement_revision:\s*context\.entitlementRevision/,
  );
  assert.match(
    routes,
    /entitlement_revision:\s*grant\.entitlementRevision/,
  );
});

test("product authorization remains OWNER-only while operators can read the directory", () => {
  assert.match(
    routes,
    /\/v1\/admin\/workforce"[\s\S]*requirePermission\("platform\.workforce\.read"\)/,
  );
  assert.match(
    routes,
    /requirePermission\(\s*"platform\.workforce\.product_access\.manage"/,
  );
  assert.match(
    routes,
    /requirePermission\("platform\.workforce\.manage"\)/,
  );
  assert.match(routes, /z\.literal\("CREATE STAFF"\)/);
  assert.match(routes, /requiredConfirmation/);
  assert.match(routes, /"GRANT PRODUCT ACCESS"/);
  assert.match(routes, /z\.literal\("REVOKE PRODUCT ACCESS"\)/);
  assert.match(routes, /z\.literal\("TERMINATE STAFF"\)/);
});

test("workforce suspension/reactivation are governed containment transitions", () => {
  const suspend = workforce.slice(
    workforce.indexOf("export async function suspendWorkforceIdentity"),
    workforce.indexOf("export async function reactivateWorkforceIdentity"),
  );
  const reactivate = workforce.slice(
    workforce.indexOf("export async function reactivateWorkforceIdentity"),
    workforce.indexOf("export async function terminateWorkforceIdentity"),
  );

  assert.match(suspend, /cannot_suspend_self/);
  assert.match(suspend, /cannot_suspend_last_owner/);
  assert.match(suspend, /session\.updateMany/);
  assert.match(suspend, /oAuthRefreshToken\.updateMany/);
  assert.match(suspend, /status:\s*"LOCKED"/);
  assert.match(suspend, /employmentStatus:\s*"SUSPENDED"/);
  assert.match(suspend, /entitlementRevision:\s*\{ increment: 1 \}/);
  assert.match(suspend, /WORKFORCE_STAFF_SUSPENDED/);

  assert.match(reactivate, /status:\s*"ACTIVE"/);
  assert.match(reactivate, /employmentStatus:\s*"ACTIVE"/);
  assert.match(reactivate, /entitlementRevision:\s*\{ increment: 1 \}/);
  assert.match(reactivate, /WORKFORCE_STAFF_REACTIVATED/);
  assert.match(reactivate, /sessionReestablishmentRequired:\s*true/);

  assert.match(routes, /z\.literal\("SUSPEND STAFF"\)/);
  assert.match(routes, /z\.literal\("REACTIVATE STAFF"\)/);
  assert.match(routes, /\/v1\/admin\/workforce\/:staffId\/suspend/);
  assert.match(routes, /\/v1\/admin\/workforce\/:staffId\/reactivate/);
});

test("Frendelo Super Admin product assignment requires elevated confirmation", () => {
  assert.match(routes, /GRANT FRENDELO SUPER ADMIN/);
  assert.match(routes, /GRANT PRODUCT ACCESS/);
  assert.match(routes, /product_access_confirmation_required/);
});

test("Frendelo Super Admin parent authority cannot disappear implicitly", () => {
  const grant = workforce.slice(
    workforce.indexOf("export async function grantWorkforceProductAccess"),
    workforce.indexOf("export async function revokeWorkforceProductAccess"),
  );
  const revoke = workforce.slice(
    workforce.indexOf("export async function revokeWorkforceProductAccess"),
    workforce.indexOf("export async function suspendWorkforceIdentity"),
  );
  const suspend = workforce.slice(
    workforce.indexOf("export async function suspendWorkforceIdentity"),
    workforce.indexOf("export async function reactivateWorkforceIdentity"),
  );
  const terminate = workforce.slice(
    workforce.indexOf("export async function terminateWorkforceIdentity"),
    workforce.indexOf("export async function workforceProductContextByUserId"),
  );
  const context = workforce.slice(
    workforce.indexOf("export async function workforceProductContextByUserId"),
  );

  assert.match(grant, /frendelo_super_admin_must_be_permanent/);
  assert.match(revoke, /cannot_revoke_last_frendelo_super_admin/);
  assert.match(suspend, /cannot_suspend_last_frendelo_super_admin/);
  assert.match(terminate, /cannot_terminate_last_frendelo_super_admin/);
  assert.match(context, /cannot_expire_last_frendelo_super_admin/);

  for (const mutation of [revoke, suspend, terminate]) {
    assert.match(mutation, /isolationLevel:\s*"Serializable"/);
    assert.match(mutation, /workforce_change_conflict_retry/);
  }
});

test("global termination contains identity and all renewable/product authority atomically", () => {
  const terminate = workforce.slice(
    workforce.indexOf("export async function terminateWorkforceIdentity"),
  );
  assert.match(terminate, /db\.\$transaction/);
  assert.match(terminate, /cannot_terminate_self/);
  assert.match(terminate, /cannot_terminate_last_owner/);
  assert.match(terminate, /workforceProductAccessGrant\.updateMany/);
  assert.match(terminate, /platformRoleGrant\.updateMany/);
  assert.match(terminate, /session\.updateMany/);
  assert.match(terminate, /oAuthRefreshToken\.updateMany/);
  assert.match(terminate, /status:\s*"DISABLED"/);
  assert.match(terminate, /employmentStatus:\s*"TERMINATED"/);
  assert.match(terminate, /eventType:\s*"WORKFORCE_STAFF_TERMINATED"/);
});

test("staff invite acceptance activates the attached workforce profile", () => {
  assert.match(auth, /activateInvitedWorkforce\(userId\)/);
  assert.match(auth, /WORKFORCE_STAFF_ACTIVATED/);
  assert.match(workforce, /employmentStatus:\s*"ACTIVE"/);
});

test("workforce routes are registered by MigraAuth", () => {
  assert.match(server, /import \{ workforceRoutes \} from "\.\/routes\/workforce\.js"/);
  assert.match(server, /app\.register\(workforceRoutes\)/);
});

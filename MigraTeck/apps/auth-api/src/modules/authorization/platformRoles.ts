/**
 * Platform operator authority.
 *
 * REPLACES `AUTH_ADMIN_USER_IDS`, an env allowlist written as a deliberate
 * stopgap to close a live hole. An env var cannot say who granted access or
 * when, cannot be revoked without a deploy, is invisible to any interface, and
 * is edited by whoever can edit a unit file. Authority over every account in the
 * platform belongs in the database with an author and a timestamp.
 *
 * PERMISSIONS ARE THE PRIMITIVE; ROLES ARE BUNDLES OVER THEM. Guards ask for a
 * PERMISSION, never a role. That way re-cutting the bundles — splitting
 * OPERATOR, adding a read-only auditor — is an edit to one table in this file
 * with tests, not a hunt through route handlers for `role === "operator"`.
 */

import { db } from "../../lib/db.js";
import type { PlatformRole } from "../../prisma-client.js";

/**
 * Everything an operator can do, named by what it IS rather than by which route
 * exposes it. Routes move; the authority they represent does not.
 */
export const PLATFORM_PERMISSIONS = [
  /**
   * Read YOUR OWN platform authority — who you are and what you may do.
   *
   * Held by every platform role, because it is not a power over anything: it is
   * the answer a caller needs before it can act at all. It was previously
   * implied by `platform.users.read`, which coupled "identify myself" to
   * "enumerate other people" — so a narrow model-operator holding only
   * `platform.models.qualify` could never discover its own identity, and the
   * operator tool that must derive an approver from this endpoint would have
   * been locked out of it.
   */
  "platform.self.read",
  /** Read account records: listing, searching, viewing one. */
  "platform.users.read",
  /** Lock, unlock or disable an account. Changes whether someone can sign in. */
  "platform.users.suspend",
  /**
   * Clear someone's TOTP enrolment so they can re-enrol.
   *
   * SEPARATE FROM `suspend` ON PURPOSE. Suspending removes access; this REMOVES
   * A SECURITY CONTROL from an account that keeps working — the one operation
   * here that makes an account easier to reach rather than harder. It is the
   * natural target for anyone who has talked their way into support, so it is
   * grantable on its own and withheld on its own.
   */
  "platform.users.mfa_reset",
  /** Read OAuth client configuration. */
  "platform.clients.read",
  /** Read the platform audit log. */
  "platform.audit.read",
  /** Grant and revoke platform roles — authority over authority. */
  "platform.roles.manage",
  /**
   * Approve or revoke a model for production use.
   *
   * SEPARATE FROM `roles.manage`, because they are different powers over
   * different things: one decides who may operate the platform, the other
   * decides which model may answer users. An operator who should be able to
   * qualify a vision model does not thereby need the ability to grant
   * themselves ownership — and the reverse is just as true.
   *
   * It is checked by the operator tool that mints a signed request to the
   * Brain; the Brain then verifies the SIGNATURE and its own service/action
   * policy. Two boundaries, deliberately: this one authorizes the human, that
   * one authenticates the caller.
   */
  "platform.models.qualify",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/**
 * WHAT EACH ROLE MAY DO. The only place this is written down.
 *
 * SUPPORT can look and cannot touch: the common case is answering "what
 * happened to my account?", which needs reading and nothing else. Giving that
 * job the power to disable accounts is how a support tool becomes an incident.
 *
 * OPERATOR adds suspension — the actual account-lifecycle work.
 *
 * OWNER adds `roles.manage`, and is deliberately the ONLY role that can widen
 * anyone's authority, including its own. Separating "can act" from "can decide
 * who acts" is the point of having more than one role at all.
 */
const ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  SUPPORT: ["platform.self.read", "platform.users.read", "platform.audit.read"],
  OPERATOR: [
    "platform.self.read",
    "platform.users.read",
    "platform.users.suspend",
    "platform.users.mfa_reset",
    "platform.clients.read",
    "platform.audit.read",
  ],
  /*
   * OWNER holds everything, including model qualification. A narrower
   * model-operator role can be cut later without touching a guard, because
   * guards ask for the permission rather than the role.
   */
  OWNER: [...PLATFORM_PERMISSIONS],
};

export function permissionsForRoles(roles: readonly PlatformRole[]): Set<PlatformPermission> {
  const granted = new Set<PlatformPermission>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role] ?? []) granted.add(p);
  return granted;
}

/**
 * The LIVE roles held by a user.
 *
 * Read on every request, never cached. A revocation that takes effect at the
 * next deploy, or in five minutes, is not a revocation — the moment you revoke
 * someone's access is usually the moment it matters most.
 */
export async function rolesForUser(userId: string): Promise<PlatformRole[]> {
  const grants = await db.platformRoleGrant.findMany({
    where: { userId, revokedAt: null },
    select: { role: true },
  });
  return grants.map((g) => g.role);
}

export interface PlatformAuthority {
  roles: PlatformRole[];
  permissions: Set<PlatformPermission>;
  /** True when authority came from the bootstrap env allowlist, not a grant. */
  viaBootstrap: boolean;
}

/**
 * BOOTSTRAP: the env allowlist still works, and only until a real grant exists.
 *
 * A fresh deployment has an empty grants table and therefore nobody who can
 * create the first grant — authority to grant is itself a granted permission.
 * Someone has to be able to start. So `AUTH_ADMIN_USER_IDS` is honoured as an
 * OWNER-equivalent, and every use of it is REPORTED so it cannot be forgotten:
 * `viaBootstrap` reaches the audit log on each authorization.
 *
 * IT IS A FALLBACK, NOT A PARALLEL PATH. It is consulted only when the user has
 * no live grants at all. Once a real grant exists for someone, the env var stops
 * deciding anything for them — so the migration is: grant yourself OWNER, verify,
 * then delete the variable.
 */
function bootstrapUserIds(): Set<string> {
  return new Set(
    (process.env["AUTH_ADMIN_USER_IDS"] ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );
}

export async function authorityForUser(userId: string): Promise<PlatformAuthority> {
  const roles = await rolesForUser(userId);
  if (roles.length > 0) {
    return { roles, permissions: permissionsForRoles(roles), viaBootstrap: false };
  }

  if (bootstrapUserIds().has(userId)) {
    return {
      roles: ["OWNER"],
      permissions: permissionsForRoles(["OWNER"]),
      viaBootstrap: true,
    };
  }

  /*
   * NO ROLES AND NOT BOOTSTRAPPED = NOTHING. The failure mode of a
   * misconfigured deployment must be "no one is an operator", never "everyone
   * is" — which is exactly how this surface came to be open in the first place.
   */
  return { roles: [], permissions: new Set(), viaBootstrap: false };
}

export interface GrantOutcome {
  ok: boolean;
  code?: "already_held" | "unknown_user" | "last_owner" | "not_held";
  message?: string;
}

export async function grantRole(input: {
  userId: string;
  role: PlatformRole;
  grantedByUserId: string;
  note?: string | undefined;
}): Promise<GrantOutcome> {
  const subject = await db.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!subject) return { ok: false, code: "unknown_user", message: "No such user." };

  const existing = await db.platformRoleGrant.findFirst({
    where: { userId: input.userId, role: input.role, revokedAt: null },
    select: { id: true },
  });
  if (existing) return { ok: false, code: "already_held", message: "That role is already held." };

  await db.platformRoleGrant.create({
    data: {
      userId: input.userId,
      role: input.role,
      grantedByUserId: input.grantedByUserId,
      note: input.note ?? null,
    },
  });
  return { ok: true };
}

/**
 * Revoking, with the one safeguard that matters.
 *
 * THE LAST OWNER CANNOT BE REMOVED. `roles.manage` is held only by OWNER, so
 * revoking the final one leaves a platform nobody can administer — recoverable
 * only by editing the database by hand, which is precisely the situation this
 * table exists to end. Same shape as refusing to unlink an account's last
 * sign-in method, and refused for the same reason.
 */
export async function revokeRole(input: {
  userId: string;
  role: PlatformRole;
  revokedByUserId: string;
}): Promise<GrantOutcome> {
  const grant = await db.platformRoleGrant.findFirst({
    where: { userId: input.userId, role: input.role, revokedAt: null },
    select: { id: true },
  });
  if (!grant) return { ok: false, code: "not_held", message: "That role is not held." };

  if (input.role === "OWNER") {
    const owners = await db.platformRoleGrant.count({
      where: { role: "OWNER", revokedAt: null },
    });
    if (owners <= 1) {
      return {
        ok: false,
        code: "last_owner",
        message: "This is the only owner. Grant owner to someone else first, then revoke this one.",
      };
    }
  }

  /*
   * Conditional on still being live: two concurrent revocations must not both
   * report success, and `updateMany` matching zero rows is how that is detected
   * rather than assumed.
   */
  const revoked = await db.platformRoleGrant.updateMany({
    where: { id: grant.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedByUserId: input.revokedByUserId },
  });
  if (revoked.count !== 1) return { ok: false, code: "not_held", message: "That role is not held." };

  return { ok: true };
}

/** Every live grant, for the management interface. Never a secret. */
export async function listGrants(): Promise<
  { userId: string; email: string | null; role: PlatformRole; grantedAt: Date; grantedByUserId: string | null; note: string | null }[]
> {
  const grants = await db.platformRoleGrant.findMany({
    where: { revokedAt: null },
    orderBy: [{ role: "asc" }, { grantedAt: "asc" }],
    select: {
      userId: true,
      role: true,
      grantedAt: true,
      grantedByUserId: true,
      note: true,
      user: { select: { email: true } },
    },
  });
  return grants.map((g) => ({
    userId: g.userId,
    email: g.user?.email ?? null,
    role: g.role,
    grantedAt: g.grantedAt,
    grantedByUserId: g.grantedByUserId,
    note: g.note,
  }));
}

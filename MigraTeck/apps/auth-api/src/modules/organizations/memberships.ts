/**
 * MigraAuth — loading organization memberships for an authorization decision.
 *
 * Kept apart from `activeOrganization.ts` on purpose: the decision rules there are pure
 * and exhaustively tested without a database, and this is the thin layer that fetches the
 * facts they reason over. Mixing the two would make the rules need Postgres to test, which
 * is how security logic ends up under-covered.
 *
 * © MigraTeck LLC.
 */

import { db } from "../../lib/db.js";
import type { Membership, MembershipStatus } from "./activeOrganization.js";

/**
 * Every membership this user holds, in whatever state.
 *
 * Deliberately NOT filtered to active rows. The decision layer has to tell "you are not a
 * member of that organization" apart from "your membership there is suspended" — the first
 * is a wrong answer and the second is a revoked one, and collapsing them here would hide
 * a suspension behind a not-found.
 *
 * A membership that was fully removed is a deleted row and simply does not appear, which
 * the decision layer already treats as not permitted.
 */
export async function loadMemberships(userId: string): Promise<Membership[]> {
  const rows = await db.organizationMember.findMany({
    where: { userId },
    select: { id: true, organizationId: true, status: true, role: true },
    orderBy: { organizationId: "asc" },
  });

  return rows.map((row) => ({
    membershipId: row.id,
    organizationId: row.organizationId,
    status: row.status as MembershipStatus,
    // One role per membership in this schema. Emitted as a list because that is the claim
    // shape resource servers consume, and because a future multi-role membership must not
    // require every consumer to change.
    roles: [row.role],
  }));
}

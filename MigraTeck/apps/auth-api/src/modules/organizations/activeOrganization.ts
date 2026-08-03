/**
 * MigraAuth — binding a token to ONE active organization.
 *
 * A membership array in an access token does not say which tenant is authoritative for
 * the request carrying it. It leaves every resource server to guess: which organization
 * owns a new conversation, whose policy governs a coding run, which tenant belongs in the
 * audit record, and what happens when membership changes while the token is still valid.
 * Guessing differently in two services is how a tenant boundary quietly stops being one.
 *
 * So a token carries a SINGULAR `org_id`, chosen during authorization, bound into the
 * authorization code, and preserved unchanged through exchange and refresh. Switching
 * organizations means a new authorization — never a header, a body field, or a query
 * parameter on the way to the token endpoint.
 *
 * The rules live here as pure functions over memberships. No Prisma, no Fastify, no clock
 * beyond what a caller passes: the decisions are the security-relevant part, and they are
 * worth testing exhaustively without standing up a database to do it.
 *
 * © MigraTeck LLC.
 */

/** Mirrors `MemberStatus` in the schema, kept local so this module stays dependency-free. */
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

/** One membership, reduced to what an authorization decision actually needs. */
export interface Membership {
  membershipId: string;
  organizationId: string;
  status: MembershipStatus;
  roles: string[];
}

/** The organization context bound to a code, and later emitted into tokens. */
export interface ActiveOrganization {
  orgId: string;
  orgRoles: string[];
  orgMembershipId: string;
}

export type ActiveOrganizationDenial =
  /** The user belongs to no organization this client will accept. */
  | 'no_eligible_organization'
  /** Several are eligible and the request did not say which. */
  | 'organization_selection_required'
  /** The requested organization is not one this user is an active member of. */
  | 'organization_not_permitted'
  /** The membership exists but is not usable — invited, suspended or removed. */
  | 'membership_inactive';

export type ActiveOrganizationDecision =
  | { ok: true; active: ActiveOrganization }
  | { ok: true; active: undefined; reason: 'client_does_not_require_organization' }
  | { ok: false; denial: ActiveOrganizationDenial; eligibleOrganizationIds?: string[] };

/**
 * Only an ACTIVE membership counts.
 *
 * `INVITED` is an offer that was never accepted, and treating it as membership would let
 * anyone who can invite an address grant that address a tenant. `SUSPENDED` and `REMOVED`
 * are decisions that must take effect, not linger for the life of a refresh token.
 */
export function isUsableMembership(membership: Membership): boolean {
  return membership.status === 'ACTIVE';
}

export function eligibleMemberships(memberships: readonly Membership[]): Membership[] {
  return memberships.filter(isUsableMembership);
}

/**
 * Decide the active organization for an authorization request.
 *
 * `requestedOrganizationId` may come from the browser, so it is treated as a REQUEST and
 * never as authority: it selects among memberships the caller already provably has, and
 * anything else is denied rather than corrected to a default. Silently substituting a
 * different organization would be worse than refusing — the user would be acting inside a
 * tenant they did not choose and the audit trail would agree with them.
 */
export function decideActiveOrganization(input: {
  clientRequiresActiveOrganization: boolean;
  memberships: readonly Membership[];
  requestedOrganizationId?: string | undefined;
}): ActiveOrganizationDecision {
  const { clientRequiresActiveOrganization, memberships, requestedOrganizationId } = input;

  // Clients that predate organization binding keep working untouched. Making the claim
  // mandatory for every existing client in the same change would break the portal to fix
  // a consumer app that is not deployed yet.
  if (!clientRequiresActiveOrganization) {
    return { ok: true, active: undefined, reason: 'client_does_not_require_organization' };
  }

  const eligible = eligibleMemberships(memberships);

  if (requestedOrganizationId) {
    const named = memberships.find((m) => m.organizationId === requestedOrganizationId);
    if (!named) return { ok: false, denial: 'organization_not_permitted' };
    if (!isUsableMembership(named)) return { ok: false, denial: 'membership_inactive' };
    return { ok: true, active: toActive(named) };
  }

  if (eligible.length === 0) {
    return { ok: false, denial: 'no_eligible_organization' };
  }
  if (eligible.length > 1) {
    return {
      ok: false,
      denial: 'organization_selection_required',
      eligibleOrganizationIds: eligible.map((m) => m.organizationId),
    };
  }
  return { ok: true, active: toActive(eligible[0]!) };
}

/**
 * Re-check a bound organization at refresh.
 *
 * Membership can be revoked while a refresh token is still valid, and a refresh that kept
 * working afterwards would make revocation advisory. The bound organization is preserved
 * when it is still usable and the refresh is REFUSED when it is not — never quietly moved
 * to another organization the user happens to belong to, which would hand them a tenant
 * they never authorized and produce audit records naming the wrong one.
 */
export function revalidateActiveOrganization(input: {
  boundOrganizationId: string | undefined;
  memberships: readonly Membership[];
  clientRequiresActiveOrganization: boolean;
}): ActiveOrganizationDecision {
  const { boundOrganizationId, memberships, clientRequiresActiveOrganization } = input;

  if (!clientRequiresActiveOrganization) {
    return { ok: true, active: undefined, reason: 'client_does_not_require_organization' };
  }
  if (!boundOrganizationId) {
    // A client that requires an organization must not acquire one at refresh time; the
    // binding is made where the user consented to it.
    return { ok: false, denial: 'no_eligible_organization' };
  }

  const bound = memberships.find((m) => m.organizationId === boundOrganizationId);
  if (!bound) return { ok: false, denial: 'organization_not_permitted' };
  if (!isUsableMembership(bound)) return { ok: false, denial: 'membership_inactive' };
  return { ok: true, active: toActive(bound) };
}

/**
 * Claims for the active organization.
 *
 * Roles are the SELECTED organization's only. Emitting roles a user holds elsewhere would
 * let a resource server read `org_roles` as authority inside a tenant that never granted
 * it — an admin of one organization must not read as an admin of another.
 */
export function activeOrganizationClaims(active: ActiveOrganization): {
  org_id: string;
  org_roles: string[];
  org_membership_id: string;
} {
  return {
    org_id: active.orgId,
    org_roles: [...active.orgRoles],
    org_membership_id: active.orgMembershipId,
  };
}

function toActive(membership: Membership): ActiveOrganization {
  return {
    orgId: membership.organizationId,
    orgRoles: [...membership.roles],
    orgMembershipId: membership.membershipId,
  };
}

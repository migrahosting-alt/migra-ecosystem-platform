import type { OrgRole, Organization, User } from "@prisma/client";
import type {
  IdentityContextView,
  IdentityMembershipView,
  IdentityOrganizationView,
  IdentityRole,
  IdentitySessionView,
  IdentityUserStatus,
  IdentityUserView,
} from "@migrateck/api-contracts";

type MembershipShape = {
  id: string;
  role: OrgRole;
  createdAt: Date;
  org: Pick<Organization, "id" | "name" | "slug">;
};

function splitDisplayName(name: string | null | undefined) {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { firstName: null, lastName: null };
  }

  const [firstName = "", ...rest] = trimmed.split(/\s+/);
  return {
    firstName: firstName || null,
    lastName: rest.length > 0 ? rest.join(" ") : null,
  };
}

export function deriveUserStatus(input: {
  emailVerified: Date | null;
  accountLockedUntil?: Date | null | undefined;
}): IdentityUserStatus {
  if (input.accountLockedUntil && input.accountLockedUntil > new Date()) {
    return "LOCKED";
  }

  if (!input.emailVerified) {
    return "PENDING_VERIFICATION";
  }

  return "ACTIVE";
}

export function toIdentityOrganizationView(
  organization: Pick<Organization, "id" | "name" | "slug">,
): IdentityOrganizationView {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
  };
}

export function toIdentityUserView(
  user: Pick<User, "id" | "email" | "name" | "emailVerified" | "createdAt" | "updatedAt" | "accountLockedUntil">,
): IdentityUserView {
  const names = splitDisplayName(user.name);
  return {
    id: user.id,
    email: user.email,
    firstName: names.firstName,
    lastName: names.lastName,
    displayName: user.name ?? null,
    status: deriveUserStatus({
      emailVerified: user.emailVerified,
      accountLockedUntil: user.accountLockedUntil,
    }),
    emailVerifiedAt: user.emailVerified?.toISOString() ?? null,
    createdAt: user.createdAt?.toISOString() ?? null,
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}

export function toIdentityMembershipView(
  membership: MembershipShape,
  currentOrgId?: string | null | undefined,
): IdentityMembershipView {
  return {
    membershipId: membership.id,
    organization: toIdentityOrganizationView(membership.org),
    role: membership.role as IdentityRole,
    joinedAt: membership.createdAt.toISOString(),
    isCurrent: membership.org.id === currentOrgId,
  };
}

export function buildIdentityContext(input: {
  user: Pick<User, "id" | "email" | "name" | "emailVerified" | "createdAt" | "updatedAt" | "accountLockedUntil">;
  memberships: MembershipShape[];
  activeMembership?: MembershipShape | null | undefined;
  accessToken?: string | undefined;
  session?: IdentitySessionView | undefined;
}): IdentityContextView {
  const currentOrgId = input.activeMembership?.org.id ?? null;

  return {
    user: toIdentityUserView(input.user),
    activeOrganization: input.activeMembership
      ? toIdentityOrganizationView(input.activeMembership.org)
      : null,
    activeRole: input.activeMembership ? (input.activeMembership.role as IdentityRole) : null,
    memberships: input.memberships.map((membership) =>
      toIdentityMembershipView(membership, currentOrgId),
    ),
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
    ...(input.session ? { session: input.session } : {}),
  };
}
import { MembershipStatus, OrgRole } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookie";

export type AppAuthSession = {
  sessionId: string;
  authUserId: string | null;
  user: {
    id: string;
    authUserId: string | null;
    name: string | null;
    email: string | null;
    defaultOrgId: string | null;
    emailVerified: boolean;
    organizations: {
      id: string;
      name: string;
      slug: string;
      role: OrgRole;
      isMigraHostingClient: boolean;
    }[];
  };
};

export async function getAuthSession() {
  const cookieStore = await cookies();
  const sessionToken = SESSION_COOKIE_NAMES.map((name) => cookieStore.get(name)?.value).find(Boolean);

  if (!sessionToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken },
    include: {
      user: {
        select: {
          id: true,
          authUserId: true,
          name: true,
          email: true,
          defaultOrgId: true,
          emailVerified: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expires <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const memberships = await prisma.membership.findMany({
    where: {
      userId: session.userId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
          slug: true,
          isMigraHostingClient: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    sessionId: session.id,
    authUserId: session.user.authUserId,
    user: {
      id: session.user.id,
      authUserId: session.user.authUserId,
      name: session.user.name,
      email: session.user.email,
      defaultOrgId: session.user.defaultOrgId,
      emailVerified: Boolean(session.user.emailVerified),
      organizations: memberships.map((membership) => ({
        id: membership.org.id,
        name: membership.org.name,
        slug: membership.org.slug,
        role: membership.role,
        isMigraHostingClient: membership.org.isMigraHostingClient,
      })),
    },
  } satisfies AppAuthSession;
}

export async function requireAuthSession() {
  const session = await getAuthSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return session;
}

export async function getActiveOrgContext(userId: string) {
  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      ...(activeOrgId ? { orgId: activeOrgId } : {}),
    },
    include: { org: true },
    orderBy: { createdAt: "asc" },
  });

  if (membership) {
    return membership;
  }

  return prisma.membership.findFirst({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
    },
    include: { org: true },
    orderBy: { createdAt: "asc" },
  });
}

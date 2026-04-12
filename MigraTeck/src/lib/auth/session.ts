import { MembershipStatus } from "@prisma/client";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export async function getAuthSession() {
  return getServerSession(authOptions);
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

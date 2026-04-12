import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { MembershipStatus } from "@prisma/client";
import type { NextAuthOptions } from "next-auth";
import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  ...(env.NEXTAUTH_SECRET ? { secret: env.NEXTAUTH_SECRET } : {}),
  providers: [],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async session({ session, user }) {
      if (!session.user) {
        return session;
      }

      const memberships = await prisma.membership.findMany({
        where: {
          userId: user.id,
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
      });

      session.user.id = user.id;
      session.user.defaultOrgId = user.defaultOrgId;
      session.user.emailVerified = Boolean(user.emailVerified);
      session.user.organizations = memberships.map((membership) => ({
        id: membership.org.id,
        name: membership.org.name,
        slug: membership.org.slug,
        role: membership.role,
        isMigraHostingClient: membership.org.isMigraHostingClient,
      }));

      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      await writeAuditLog({
        userId: user.id,
        action: "AUTH_SIGNIN_EVENT",
        metadata: { provider: account?.provider },
      });
    },
    async signOut({ session }) {
      if (!session?.user?.email) {
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
      });

      await writeAuditLog({
        userId: user?.id,
        action: "AUTH_SIGNOUT_EVENT",
      });
    },
  },
};

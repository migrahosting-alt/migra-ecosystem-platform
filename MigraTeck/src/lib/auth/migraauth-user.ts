import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { normalizeEmail } from "@/lib/auth/migraauth";

type LinkOrCreateUserInput = {
  authUserId: string;
  email: string;
  displayName?: string | null | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
};

export async function linkOrCreateUser(input: LinkOrCreateUserInput) {
  const emailNormalized = normalizeEmail(input.email);

  const result = await prisma.$transaction(async (tx) => {
    const existingByAuthUserId = await tx.user.findFirst({
      where: { authUserId: input.authUserId },
    });

    if (existingByAuthUserId) {
      const updated = await tx.user.update({
        where: { id: existingByAuthUserId.id },
        data: {
          email: input.email,
          emailNormalized,
          ...(input.displayName ? { name: input.displayName } : {}),
        },
      });

      return {
        user: updated,
        action: "matched_by_auth_user_id" as const,
      };
    }

    const matchingUsers = await tx.user.findMany({
      where: {
        OR: [
          { emailNormalized },
          { email: input.email },
          { email: emailNormalized },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 3,
    });

    const dedupedMatchingUsers = matchingUsers.filter(
      (user, index, list) => list.findIndex((candidate) => candidate.id === user.id) === index,
    );

    if (dedupedMatchingUsers.length > 1) {
      throw new Error(`Identity conflict: multiple users share ${emailNormalized}.`);
    }

    const existingByEmail = dedupedMatchingUsers[0];

    if (existingByEmail) {
      if (existingByEmail.authUserId && existingByEmail.authUserId !== input.authUserId) {
        throw new Error(
          `Identity conflict: local user ${existingByEmail.id} is already linked to a different authUserId.`,
        );
      }

      const updated = await tx.user.update({
        where: { id: existingByEmail.id },
        data: {
          authUserId: input.authUserId,
          email: input.email,
          emailNormalized,
          ...(input.displayName ? { name: input.displayName } : {}),
        },
      });

      return {
        user: updated,
        action: "linked_existing_by_email" as const,
      };
    }

    const created = await tx.user.create({
      data: {
        authUserId: input.authUserId,
        email: input.email,
        emailNormalized,
        ...(input.displayName ? { name: input.displayName } : {}),
      },
    });

    return {
      user: created,
      action: "created_new_user" as const,
    };
  });

  await writeAuditLog({
    userId: result.user.id,
    action: "AUTH_MIGRAAUTH_USER_LINK",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      result: result.action,
      authUserId: input.authUserId,
      emailNormalized,
    },
  });

  return result;
}

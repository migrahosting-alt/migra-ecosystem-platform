import { writeAuditLog } from "@migrateck/audit-core";
import { emitPlatformEvent, recordSecurityEvent } from "@migrateck/events";
import { prisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { hashToken } from "@/lib/tokens";
import { AuthCoreError } from "../errors";

export async function verifyEmailToken(input: {
  token: string;
  ip: string;
  userAgent: string;
}): Promise<{ message: string; emailVerifiedAt: string }> {
  const tokenHash = hashToken(input.token);
  const limiter = await assertRateLimit({
    key: `${input.ip}:${tokenHash}`,
    action: "auth:v1:verify-email",
    maxAttempts: 12,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    throw new AuthCoreError("RATE_LIMITED", "Too many verification attempts. Try again later.", 429);
  }

  const verification = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!verification || verification.usedAt || verification.expiresAt < new Date()) {
    throw new AuthCoreError("INVALID_TOKEN", "Verification link is invalid or expired.", 400);
  }

  const emailVerifiedAt = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: verification.userId },
      data: { emailVerified: emailVerifiedAt },
    }),
    prisma.emailVerificationToken.update({
      where: { id: verification.id },
      data: { usedAt: emailVerifiedAt },
    }),
  ]);

  const membership = await prisma.membership.findFirst({
    where: { userId: verification.userId },
    select: { orgId: true },
    orderBy: { createdAt: "asc" },
  });

  await writeAuditLog({
    userId: verification.userId,
    orgId: membership?.orgId ?? null,
    action: "AUTH_EMAIL_VERIFIED",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await recordSecurityEvent({
    userId: verification.userId,
    orgId: membership?.orgId ?? null,
    eventType: "EMAIL_VERIFIED",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await emitPlatformEvent({
    eventType: "user.updated",
    source: "auth-core.verify-email",
    orgId: membership?.orgId,
    actorId: verification.userId,
    entityType: "User",
    entityId: verification.userId,
    payload: { emailVerifiedAt: emailVerifiedAt.toISOString() },
  });

  return {
    message: "Email verified.",
    emailVerifiedAt: emailVerifiedAt.toISOString(),
  };
}
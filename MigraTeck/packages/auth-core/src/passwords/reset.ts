import { writeAuditLog } from "@migrateck/audit-core";
import { emitPlatformEvent, recordSecurityEvent } from "@migrateck/events";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { hashPassword } from "@/lib/security/password";
import { generateToken, hashToken } from "@/lib/tokens";
import { validateEnterprisePassword } from "../credentials/password-policy";
import { AuthCoreError } from "../errors";

const PASSWORD_RESET_WINDOW_MS = 30 * 60 * 1000;

export async function requestPasswordReset(input: {
  email: string;
  ip: string;
  userAgent: string;
}): Promise<{ message: string }> {
  const email = input.email.toLowerCase();
  const limiter = await assertRateLimit({
    key: `${email}:${input.ip}`,
    action: "auth:v1:forgot-password",
    maxAttempts: 6,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    throw new AuthCoreError("RATE_LIMITED", "Too many reset attempts. Try again later.", 429);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
    },
  });

  if (user?.email) {
    const token = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_WINDOW_MS),
      },
    });

    const baseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: "Reset your MigraTeck password",
      text: `Reset your password: ${resetUrl}`,
      html: `<p><a href="${resetUrl}">Reset password</a></p>`,
    });

    await writeAuditLog({
      userId: user.id,
      action: "AUTH_PASSWORD_RESET_REQUESTED",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await recordSecurityEvent({
      userId: user.id,
      eventType: "PASSWORD_RESET_REQUESTED",
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  return {
    message: "If the account exists, reset instructions have been sent.",
  };
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
  ip: string;
  userAgent: string;
}): Promise<{ message: string }> {
  const tokenHash = hashToken(input.token);
  const limiter = await assertRateLimit({
    key: `${input.ip}:${tokenHash}`,
    action: "auth:v1:reset-password",
    maxAttempts: 8,
    windowSeconds: 30 * 60,
  });

  if (!limiter.ok) {
    throw new AuthCoreError("RATE_LIMITED", "Too many reset attempts. Try later.", 429);
  }

  const passwordError = validateEnterprisePassword(input.password);
  if (passwordError) {
    throw new AuthCoreError("WEAK_PASSWORD", passwordError, 400);
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw new AuthCoreError("INVALID_TOKEN", "Reset link is invalid or expired.", 400);
  }

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        accountLockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: resetToken.userId } }),
    prisma.refreshSession.updateMany({
      where: {
        userId: resetToken.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    }),
  ]);

  await writeAuditLog({
    userId: resetToken.userId,
    action: "AUTH_PASSWORD_RESET_COMPLETED",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await recordSecurityEvent({
    userId: resetToken.userId,
    eventType: "PASSWORD_RESET_COMPLETED",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await recordSecurityEvent({
    userId: resetToken.userId,
    eventType: "ALL_SESSIONS_REVOKED",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { reason: "password_reset" },
  });
  await emitPlatformEvent({
    eventType: "security.password_changed",
    source: "auth-core.reset-password",
    actorId: resetToken.userId,
    entityType: "User",
    entityId: resetToken.userId,
  });

  return {
    message: "Password has been reset. Please sign in with your new password.",
  };
}
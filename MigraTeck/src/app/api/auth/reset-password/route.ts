import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { hashPassword, validatePasswordComplexity } from "@/lib/security/password";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { hashToken } from "@/lib/tokens";

const schema = z.object({
  token: z.string().min(20),
  password: z.string().min(10).max(256),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const limiter = await assertRateLimit({
    key: `${ip}:${hashToken(parsed.data.token)}`,
    action: "auth:reset-password",
    maxAttempts: 8,
    windowSeconds: 30 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Too many reset attempts. Try later." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const tokenHash = hashToken(parsed.data.token);

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invalid reset request." }, { status: 400 });
  }

  const complexityError = validatePasswordComplexity(parsed.data.password);
  if (complexityError) {
    return NextResponse.json({ error: complexityError }, { status: 400 });
  }

  const newHash = await hashPassword(parsed.data.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: newHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: resetToken.userId } }),
  ]);

  await writeAuditLog({
    userId: resetToken.userId,
    action: "AUTH_PASSWORD_RESET_COMPLETED",
    ip,
    userAgent,
  });

  return NextResponse.json({ message: "Password reset complete. Sign in with your new password." });
}

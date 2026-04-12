import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { hashToken } from "@/lib/tokens";

const verifySchema = z.object({
  token: z.string().min(20),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }
  const body = await request.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token." }, { status: 400 });
  }

  const tokenHash = hashToken(parsed.data.token);
  const limiter = await assertRateLimit({
    key: `${ip}:${tokenHash}`,
    action: "auth:verify-email",
    maxAttempts: 12,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Too many verification attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const verification = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!verification || verification.usedAt || verification.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invalid verification request." }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: verification.userId },
      data: { emailVerified: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: verification.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await writeAuditLog({
    userId: verification.userId,
    action: "AUTH_EMAIL_VERIFIED",
    ip,
    userAgent,
  });

  return NextResponse.json({ message: "Email verified. You can now access critical actions." });
}

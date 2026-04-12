import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { encryptTotpSecret, verifyTotpCode } from "@/lib/security/totp";
import { assertRateLimit } from "@/lib/security/rate-limit";

const bodySchema = z.object({
  secret: z.string().min(16).max(128),
  code: z.string().min(6).max(12),
});

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "security:totp:verify",
    maxAttempts: 20,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const valid = verifyTotpCode(parsed.data.secret, parsed.data.code);
  if (!valid) {
    await writeAuditLog({
      actorId: actorUserId,
      action: "SECURITY_TOTP_ENROLLMENT_FAILED",
      resourceType: "security_totp",
      resourceId: actorUserId,
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        reason: "invalid_code",
      },
    });

    return NextResponse.json({ error: "Verification failed." }, { status: 401 });
  }

  await prisma.userTotpFactor.upsert({
    where: {
      userId: actorUserId,
    },
    create: {
      userId: actorUserId,
      secretCiphertext: encryptTotpSecret(parsed.data.secret),
      enabledAt: new Date(),
      lastUsedAt: new Date(),
    },
    update: {
      secretCiphertext: encryptTotpSecret(parsed.data.secret),
      enabledAt: new Date(),
      lastUsedAt: new Date(),
    },
  });

  await writeAuditLog({
    actorId: actorUserId,
    action: "SECURITY_TOTP_ENROLLMENT_VERIFIED",
    resourceType: "security_totp",
    resourceId: actorUserId,
    ip,
    userAgent,
    riskTier: 2,
  });

  return NextResponse.json({ ok: true });
}

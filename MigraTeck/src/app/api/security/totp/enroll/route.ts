import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { APP_NAME } from "@/lib/constants";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { buildOtpAuthUrl, generateTotpSecret } from "@/lib/security/totp";
import { assertRateLimit } from "@/lib/security/rate-limit";

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
  const userEmail = authResult.session.user.email || `${actorUserId}@migrateck.local`;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "security:totp:enroll",
    maxAttempts: 30,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const secret = generateTotpSecret();
  const otpAuthUrl = buildOtpAuthUrl({
    issuer: APP_NAME,
    accountName: userEmail,
    secret,
  });

  await writeAuditLog({
    actorId: actorUserId,
    action: "SECURITY_TOTP_ENROLLMENT_INITIATED",
    resourceType: "security_totp",
    resourceId: actorUserId,
    ip,
    userAgent,
    riskTier: 1,
    metadata: {
      accountName: userEmail,
    },
  });

  return NextResponse.json({
    secret,
    otpAuthUrl,
  });
}

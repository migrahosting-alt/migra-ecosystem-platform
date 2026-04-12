import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { attachSessionCookie, createUserSession } from "@/lib/auth/manual-session";
import { verifyLoginSmsOtp } from "@/lib/auth/sms-otp";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  phone: z.string().min(10).max(30),
  code: z.string().trim().length(6),
});

export const dynamic = "force-dynamic";

function jsonNoStore(payload: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(headers || {}),
    },
  });
}

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid payload." }, 400);
  }

  const limiter = await assertRateLimit({
    key: `${parsed.data.phone.trim()}:${ip}`,
    action: "auth:sms-login:verify",
    maxAttempts: 12,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return jsonNoStore(
      { error: "Too many verification attempts. Try again later." },
      429,
      { "Retry-After": String(limiter.retryAfterSeconds) },
    );
  }

  const result = await verifyLoginSmsOtp(parsed.data.phone, parsed.data.code);
  if (!result.ok) {
    await writeAuditLog({
      action: "AUTH_SMS_LOGIN_FAILED",
      ip,
      userAgent,
      metadata: {
        phone: parsed.data.phone.trim(),
        reason: result.reason,
      },
    });

    return jsonNoStore({ error: "Invalid or expired code." }, 401);
  }

  const { sessionToken, expiresAt, prunedSessions } = await createUserSession(result.user.id);

  await writeAuditLog({
    action: "AUTH_LOGIN_SUCCESS",
    userId: result.user.id,
    ip,
    userAgent,
    metadata: {
      method: "sms_otp",
      sessionPrunedCount: prunedSessions,
    },
  });

  const response = jsonNoStore({
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
    },
  });

  attachSessionCookie(request, response, sessionToken, expiresAt);

  return response;
}
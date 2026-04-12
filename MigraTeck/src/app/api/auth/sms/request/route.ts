import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requestLoginSmsOtp } from "@/lib/auth/sms-otp";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  phone: z.string().min(10).max(30),
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
    action: "auth:sms-login:request",
    maxAttempts: 5,
    windowSeconds: 10 * 60,
  });

  if (!limiter.ok) {
    return jsonNoStore(
      { error: "Too many code requests. Try again later." },
      429,
      { "Retry-After": String(limiter.retryAfterSeconds) },
    );
  }

  try {
    const result = await requestLoginSmsOtp(parsed.data.phone);

    await writeAuditLog({
      action: result.sent ? "AUTH_SMS_OTP_SENT" : "AUTH_SMS_OTP_REQUEST_IGNORED",
      ip,
      userAgent,
      metadata: {
        phone: result.normalizedPhone,
      },
    });

    return jsonNoStore({ message: "If the number is eligible, a sign-in code has been sent." }, 202);
  } catch (error) {
    await writeAuditLog({
      action: "AUTH_SMS_OTP_SEND_FAILED",
      ip,
      userAgent,
      metadata: {
        phone: parsed.data.phone.trim(),
        reason: error instanceof Error ? error.message : "unknown_send_failure",
      },
    });

    return jsonNoStore({ error: "SMS delivery is unavailable right now." }, 502);
  }
}
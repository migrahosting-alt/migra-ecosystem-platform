import { NextRequest } from "next/server";
import { forgotPasswordRequestSchema } from "@migrateck/api-contracts";
import { requestPasswordReset } from "@migrateck/auth-core";
import { jsonError, jsonFromError, jsonSuccess } from "@/lib/http/v1-response";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return jsonError("CSRF_FAILED", "CSRF validation failed.", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = forgotPasswordRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_PAYLOAD", "Invalid payload.", 400);
  }

  try {
    const result = await requestPasswordReset({
      email: parsed.data.email,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });
    return jsonSuccess(result);
  } catch (error) {
    return jsonFromError(error);
  }
}
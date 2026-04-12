import { NextRequest } from "next/server";
import { resendVerificationRequestSchema } from "@migrateck/api-contracts";
import { resendVerification } from "@migrateck/auth-core";
import { getClientIp, getUserAgent } from "@/lib/request";
import { jsonError, jsonFromError, jsonSuccess } from "@/lib/http/v1-response";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = resendVerificationRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError("INVALID_PAYLOAD", "Invalid payload.", 400);
  }

  try {
    const result = await resendVerification({
      ...parsed.data,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return jsonSuccess(result);
  } catch (error) {
    return jsonFromError(error);
  }
}
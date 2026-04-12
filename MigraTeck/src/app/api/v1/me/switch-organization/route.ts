import { NextRequest } from "next/server";
import { switchOrganizationRequestSchema } from "@migrateck/api-contracts";
import { getCurrentIdentityContext } from "@migrateck/auth-core";
import { switchActiveOrganizationForUser } from "@migrateck/org-core";
import { requireApiSession } from "@/lib/auth/api-auth";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { jsonError, jsonFromError, jsonSuccess } from "@/lib/http/v1-response";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return jsonError("CSRF_FAILED", "CSRF validation failed.", 403);
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return jsonError("UNAUTHORIZED", "Unauthorized.", 401);
  }

  const body = await request.json().catch(() => null);
  const parsed = switchOrganizationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_PAYLOAD", "Invalid payload.", 400);
  }

  try {
    await switchActiveOrganizationForUser({
      userId: authResult.session.user.id,
      orgId: parsed.data.orgId,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    const data = await getCurrentIdentityContext({
      userId: authResult.session.user.id,
      preferredOrgId: parsed.data.orgId,
    });

    const response = jsonSuccess(data);
    response.cookies.set(ACTIVE_ORG_COOKIE, parsed.data.orgId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    return jsonFromError(error);
  }
}
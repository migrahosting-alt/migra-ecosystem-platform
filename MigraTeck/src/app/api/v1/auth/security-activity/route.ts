import { NextRequest } from "next/server";
import { listIdentitySecurityActivity } from "@migrateck/auth-core";
import { requireApiSession } from "@/lib/auth/api-auth";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { jsonError, jsonFromError, jsonSuccess } from "@/lib/http/v1-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return jsonError("UNAUTHORIZED", "Unauthorized.", 401);
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const cursor = request.nextUrl.searchParams.get("cursor") || undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  try {
    const data = await listIdentitySecurityActivity({
      userId: authResult.session.user.id,
      orgId: request.cookies.get(ACTIVE_ORG_COOKIE)?.value || undefined,
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return jsonSuccess(data);
  } catch (error) {
    return jsonFromError(error);
  }
}
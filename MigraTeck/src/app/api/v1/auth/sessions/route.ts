import { NextRequest } from "next/server";
import { listIdentitySessions } from "@migrateck/auth-core";
import { requireApiSession } from "@/lib/auth/api-auth";
import { readRefreshCookie } from "@/lib/auth/refresh-cookie";
import { readSessionCookie } from "@/lib/auth/session-token";
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
    const data = await listIdentitySessions({
      userId: authResult.session.user.id,
      currentRefreshToken: readRefreshCookie(request),
      currentSessionToken: readSessionCookie(request),
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return jsonSuccess(data);
  } catch (error) {
    return jsonFromError(error);
  }
}
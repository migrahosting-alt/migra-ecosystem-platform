import { NextRequest, NextResponse } from "next/server";
import { clearRefreshCookie } from "@/lib/auth/refresh-cookie";
import { revokeAllRefreshSessionsForUser } from "@/lib/auth/refresh-session";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }
  const { session } = authResult;

  await prisma.session.deleteMany({
    where: { userId: session.user.id },
  });

  await revokeAllRefreshSessionsForUser(session.user.id);

  await writeAuditLog({
    userId: session.user.id,
    action: "AUTH_LOGOUT_ALL_DEVICES",
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  const response = NextResponse.json({ message: "All active sessions invalidated." });
  clearRefreshCookie(response);
  return response;
}

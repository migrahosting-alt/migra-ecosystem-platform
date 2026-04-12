import { ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

type ManageContext = {
  session: { user: { id: string } };
  activeOrg: NonNullable<Awaited<ReturnType<typeof getActiveOrgContext>>>;
  ip?: string | undefined;
  userAgent?: string | undefined;
};

export async function requireMigraMarketManageContext(request: NextRequest, route: string): Promise<
  | { ok: true; context: ManageContext }
  | { ok: false; response: NextResponse }
> {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return { ok: false, response: csrfFailure };
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return { ok: false, response: authResult.response };
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return { ok: false, response: NextResponse.json({ error: "No active organization." }, { status: 404 }) };
  }

  const ip = getClientIp(request) || undefined;
  const userAgent = getUserAgent(request) || undefined;
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route,
    ip,
    userAgent,
  });

  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route,
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return {
        ok: false,
        response: NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus }),
      };
    }

    throw error;
  }

  return {
    ok: true,
    context: {
      session: authResult.session,
      activeOrg,
      ip,
      userAgent,
    },
  };
}

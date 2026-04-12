import { NextRequest } from "next/server";
import { listActiveOrganizationsForUser } from "@migrateck/org-core";
import { requireApiSession } from "@/lib/auth/api-auth";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { jsonError, jsonFromError, jsonSuccess } from "@/lib/http/v1-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiSession();
    if (!authResult.ok) {
      return jsonError("UNAUTHORIZED", "Unauthorized.", 401);
    }

    const currentOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? null;
    const data = await listActiveOrganizationsForUser(authResult.session.user.id, currentOrgId);
    return jsonSuccess({ organizations: data });
  } catch (error) {
    return jsonFromError(error);
  }
}
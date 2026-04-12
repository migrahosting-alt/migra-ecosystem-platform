import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { listVpsServersForOrg, orgPrefersVpsWorkspace } from "@/lib/vps/data";

export const GET = safeApiHandler(async function GET() {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const membership = await getActiveOrgContext(authResult.session.user.id);

  if (!membership) {
    return NextResponse.json({ servers: [], prefersVpsWorkspace: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const [servers, prefersVpsWorkspace] = await Promise.all([
    listVpsServersForOrg(membership.orgId),
    orgPrefersVpsWorkspace(membership),
  ]);

  return NextResponse.json(
    {
      orgId: membership.orgId,
      prefersVpsWorkspace,
      servers,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

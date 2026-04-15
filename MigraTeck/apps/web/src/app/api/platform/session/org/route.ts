import { getAppSession, setAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { getPlatformOrganizations } from "@/lib/platform";

const bodySchema = z.object({
  orgId: z.string().min(1),
});

export async function POST(request: Request) {
  ensureAuthClientInitialized();

  const session = await getAppSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const body = bodySchema.parse(await request.json());
  const organizations = getPlatformOrganizations(session);
  const match = organizations.find((organization) => organization.id === body.orgId);

  if (!match) {
    return NextResponse.json(
      { error: { code: "org_not_found", message: "Organization not available in this session." } },
      { status: 404 },
    );
  }

  await setAppSession({
    ...session,
    activeOrgId: match.id,
    activeOrgName: match.name,
    activeOrgRole: match.role,
  });

  return NextResponse.json({
    activeOrg: {
      id: match.id,
      name: match.name,
      role: match.role,
    },
  });
}

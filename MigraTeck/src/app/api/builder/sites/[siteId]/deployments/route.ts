/**
 * GET /api/builder/sites/[siteId]/deployments — List deployments for a site
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, requireSiteAccess } from "@/lib/builder/auth";

type RouteParams = { params: Promise<{ siteId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:read");
  if (!auth.ok) return auth.response;

  const { siteId } = await params;
  const siteAccess = await requireSiteAccess(siteId, auth.auth.orgId);
  if (!siteAccess.ok) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Site not found." } },
      { status: 404 },
    );
  }

  const deployments = await prisma.builderDeployment.findMany({
    where: { siteId },
    orderBy: { startedAt: "desc" },
    include: { version: { select: { version: true } } },
    take: 50,
  });

  return NextResponse.json({ deployments });
}

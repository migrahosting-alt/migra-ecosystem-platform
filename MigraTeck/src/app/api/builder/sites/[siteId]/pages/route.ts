/**
 * POST /api/builder/sites/[siteId]/pages — Create a new page
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, requireSiteAccess, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";

const createPageSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

type RouteParams = { params: Promise<{ siteId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const { siteId } = await params;
  const siteCheck = await requireSiteAccess(siteId, auth.auth.orgId);
  if (!siteCheck.ok) return siteCheck.response;

  const body = await request.json().catch(() => null);
  const parsed = createPageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  // Check page slug uniqueness within site
  const existing = await prisma.builderPage.findFirst({
    where: { siteId, slug: parsed.data.slug },
  });
  if (existing) {
    return NextResponse.json(
      { error: { code: "slug_taken", message: "Page slug already exists in this site." } },
      { status: 409 },
    );
  }

  // Get next sort order
  const maxOrder = await prisma.builderPage.aggregate({
    where: { siteId },
    _max: { sortOrder: true },
  });

  const page = await prisma.builderPage.create({
    data: {
      siteId,
      title: parsed.data.title,
      slug: parsed.data.slug,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "PAGE_CREATED",
    resourceType: "builder_page",
    resourceId: page.id,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { siteId, title: page.title, slug: page.slug },
  });

  return NextResponse.json({ page }, { status: 201 });
}

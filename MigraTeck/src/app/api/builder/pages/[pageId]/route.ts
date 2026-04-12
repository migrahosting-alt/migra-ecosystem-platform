/**
 * PUT    /api/builder/pages/[pageId] — Update page metadata
 * DELETE /api/builder/pages/[pageId] — Delete a page
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";

const updatePageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  metaJson: z.record(z.string(), z.unknown()).optional(),
});

type RouteParams = { params: Promise<{ pageId: string }> };

async function getPageWithOrg(pageId: string, orgId: string) {
  return prisma.builderPage.findFirst({
    where: { id: pageId, site: { orgId } },
    include: { site: { select: { id: true, orgId: true } } },
  });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const { pageId } = await params;
  const page = await getPageWithOrg(pageId, auth.auth.orgId);
  if (!page) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Page not found." } },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updatePageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  // If changing slug, check uniqueness within site
  if (parsed.data.slug && parsed.data.slug !== page.slug) {
    const dup = await prisma.builderPage.findFirst({
      where: { siteId: page.siteId, slug: parsed.data.slug, id: { not: pageId } },
    });
    if (dup) {
      return NextResponse.json(
        { error: { code: "slug_taken", message: "Page slug already exists in this site." } },
        { status: 409 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.slug !== undefined) data.slug = parsed.data.slug;
  if (parsed.data.metaJson !== undefined) data.metaJson = parsed.data.metaJson;

  const updated = await prisma.builderPage.update({
    where: { id: pageId },
    data,
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "PAGE_UPDATED",
    resourceType: "builder_page",
    resourceId: pageId,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: parsed.data,
  });

  return NextResponse.json({ page: updated });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const { pageId } = await params;
  const page = await getPageWithOrg(pageId, auth.auth.orgId);
  if (!page) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Page not found." } },
      { status: 404 },
    );
  }

  await prisma.builderPage.delete({ where: { id: pageId } });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "PAGE_DELETED",
    resourceType: "builder_page",
    resourceId: pageId,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { siteId: page.siteId },
  });

  return NextResponse.json({ success: true });
}

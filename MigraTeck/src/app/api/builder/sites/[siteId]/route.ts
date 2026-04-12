/**
 * GET    /api/builder/sites/[siteId] — Get site with pages and sections
 * PUT    /api/builder/sites/[siteId] — Update site metadata / theme
 * DELETE /api/builder/sites/[siteId] — Archive a site
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, requireSiteAccess, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  domain: z.string().max(255).nullable().optional(),
  themeJson: z.record(z.string(), z.unknown()).optional(),
  metaJson: z.record(z.string(), z.unknown()).optional(),
});

type RouteParams = { params: Promise<{ siteId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:read");
  if (!auth.ok) return auth.response;

  const { siteId } = await params;
  const site = await prisma.builderSite.findFirst({
    where: { id: siteId, orgId: auth.auth.orgId },
    include: {
      pages: {
        orderBy: { sortOrder: "asc" },
        include: {
          sections: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  if (!site) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Site not found." } },
      { status: 404 },
    );
  }

  return NextResponse.json({ site });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const { siteId } = await params;
  const siteCheck = await requireSiteAccess(siteId, auth.auth.orgId);
  if (!siteCheck.ok) return siteCheck.response;

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  // If changing slug, check uniqueness
  if (parsed.data.slug && parsed.data.slug !== siteCheck.site.slug) {
    const existing = await prisma.builderSite.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) {
      return NextResponse.json(
        { error: { code: "slug_taken", message: "Site slug already in use." } },
        { status: 409 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.slug !== undefined) data.slug = parsed.data.slug;
  if (parsed.data.domain !== undefined) data.domain = parsed.data.domain;
  if (parsed.data.themeJson !== undefined) data.themeJson = parsed.data.themeJson;
  if (parsed.data.metaJson !== undefined) data.metaJson = parsed.data.metaJson;

  const site = await prisma.builderSite.update({
    where: { id: siteId },
    data,
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SITE_UPDATED",
    resourceType: "builder_site",
    resourceId: site.id,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: parsed.data,
  });

  return NextResponse.json({ site });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:admin");
  if (!auth.ok) return auth.response;

  const { siteId } = await params;
  const siteCheck = await requireSiteAccess(siteId, auth.auth.orgId);
  if (!siteCheck.ok) return siteCheck.response;

  await prisma.builderSite.update({
    where: { id: siteId },
    data: { status: "ARCHIVED" },
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SITE_ARCHIVED",
    resourceType: "builder_site",
    resourceId: siteId,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  return NextResponse.json({ success: true });
}

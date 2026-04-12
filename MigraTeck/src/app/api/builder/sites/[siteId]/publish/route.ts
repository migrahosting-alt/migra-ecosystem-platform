/**
 * POST /api/builder/sites/[siteId]/publish — Publish a site version + create deployment
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, requireSiteAccess, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";
import { validateSiteSchema } from "@/lib/builder/validator";
import type { SectionType } from "@/lib/builder/types";

type RouteParams = { params: Promise<{ siteId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:publish");
  if (!auth.ok) return auth.response;

  const { siteId } = await params;
  const siteAccess = await requireSiteAccess(siteId, auth.auth.orgId);
  if (!siteAccess.ok) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Site not found." } },
      { status: 404 },
    );
  }

  // Load full site with pages and sections
  const site = await prisma.builderSite.findUnique({
    where: { id: siteId },
    include: {
      pages: {
        orderBy: { sortOrder: "asc" },
        include: { sections: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!site || site.status === "ARCHIVED") {
    return NextResponse.json(
      { error: { code: "not_publishable", message: "Site cannot be published." } },
      { status: 400 },
    );
  }

  // Build the schema for validation and snapshot
  const schema = {
    name: site.name,
    theme: (site.themeJson ?? {}) as Record<string, unknown>,
    pages: site.pages.map((p) => ({
      title: p.title,
      slug: p.slug,
      sections: p.sections.map((s) => ({
        sectionType: s.sectionType as SectionType,
        props: s.propsJson as Record<string, unknown>,
        sortOrder: s.sortOrder,
        isVisible: s.isVisible,
      })),
    })),
  };

  // Validate the entire site schema before publishing
  const validation = validateSiteSchema(schema as never);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Site failed validation. Fix errors before publishing.", details: validation.errors } },
      { status: 400 },
    );
  }

  // Determine next version number
  const latestVersion = await prisma.builderSiteVersion.findFirst({
    where: { siteId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latestVersion?.version ?? 0) + 1;

  // Create version + deployment in a transaction
  const { version, deployment } = await prisma.$transaction(async (tx) => {
    const ver = await tx.builderSiteVersion.create({
      data: {
        siteId,
        version: nextVersion,
        snapshotJson: schema as unknown as Prisma.InputJsonValue,
        createdById: auth.auth.userId,
      },
    });

    const dep = await tx.builderDeployment.create({
      data: {
        siteId,
        versionId: ver.id,
        status: "PENDING",
        startedAt: new Date(),
      },
    });

    // Mark site as PUBLISHED
    await tx.builderSite.update({
      where: { id: siteId },
      data: { status: "PUBLISHED" },
    });

    return { version: ver, deployment: dep };
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SITE_PUBLISHED",
    resourceType: "builder_site",
    resourceId: siteId,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { version: nextVersion, deploymentId: deployment.id },
  });

  return NextResponse.json({
    version: { id: version.id, version: version.version },
    deployment: { id: deployment.id, status: deployment.status },
  }, { status: 201 });
}

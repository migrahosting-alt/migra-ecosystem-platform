/**
 * PUT    /api/builder/sections/[sectionId] — Update section props
 * DELETE /api/builder/sections/[sectionId] — Delete a section
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";
import { validateSectionProps } from "@/lib/builder/validator";
import { type SectionType } from "@/lib/builder/types";

const updateSectionSchema = z.object({
  propsJson: z.record(z.string(), z.unknown()).optional(),
  isVisible: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

type RouteParams = { params: Promise<{ sectionId: string }> };

async function getSectionWithOrg(sectionId: string, orgId: string) {
  return prisma.builderSection.findFirst({
    where: { id: sectionId, page: { site: { orgId } } },
    include: { page: { select: { id: true, siteId: true, site: { select: { orgId: true } } } } },
  });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const { sectionId } = await params;
  const section = await getSectionWithOrg(sectionId, auth.auth.orgId);
  if (!section) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Section not found." } },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  // If updating props, validate against section-specific schema
  if (parsed.data.propsJson) {
    const validation = validateSectionProps(section.sectionType as SectionType, parsed.data.propsJson);
    if (!validation.ok) {
      return NextResponse.json(
        { error: { code: "invalid_props", message: "Section props failed validation.", details: validation.errors } },
        { status: 400 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.propsJson !== undefined) data.propsJson = parsed.data.propsJson;
  if (parsed.data.isVisible !== undefined) data.isVisible = parsed.data.isVisible;
  if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

  const updated = await prisma.builderSection.update({
    where: { id: sectionId },
    data,
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SECTION_UPDATED",
    resourceType: "builder_section",
    resourceId: sectionId,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { sectionType: section.sectionType, ...parsed.data },
  });

  return NextResponse.json({ section: updated });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const { sectionId } = await params;
  const section = await getSectionWithOrg(sectionId, auth.auth.orgId);
  if (!section) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Section not found." } },
      { status: 404 },
    );
  }

  await prisma.builderSection.delete({ where: { id: sectionId } });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SECTION_DELETED",
    resourceType: "builder_section",
    resourceId: sectionId,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { pageId: section.pageId, sectionType: section.sectionType },
  });

  return NextResponse.json({ success: true });
}

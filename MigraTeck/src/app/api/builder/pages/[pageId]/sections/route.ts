/**
 * POST /api/builder/pages/[pageId]/sections — Create a new section in a page
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";
import { validateSectionProps } from "@/lib/builder/validator";
import { SECTION_TYPES, type SectionType } from "@/lib/builder/types";

const createSectionSchema = z.object({
  sectionType: z.enum(SECTION_TYPES as unknown as [string, ...string[]]),
  propsJson: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int().min(0).optional(),
  isVisible: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ pageId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const { pageId } = await params;
  const page = await prisma.builderPage.findFirst({
    where: { id: pageId, site: { orgId: auth.auth.orgId } },
    include: { site: { select: { id: true } } },
  });
  if (!page) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Page not found." } },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createSectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  // Validate section props against the section-specific schema
  const validation = validateSectionProps(parsed.data.sectionType as SectionType, parsed.data.propsJson);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: "invalid_props", message: "Section props failed validation.", details: validation.errors } },
      { status: 400 },
    );
  }

  // Auto-increment sortOrder if not provided
  let sortOrder = parsed.data.sortOrder;
  if (sortOrder === undefined) {
    const maxSort = await prisma.builderSection.aggregate({
      where: { pageId },
      _max: { sortOrder: true },
    });
    sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
  }

  const section = await prisma.builderSection.create({
    data: {
      pageId,
      sectionType: parsed.data.sectionType,
      propsJson: parsed.data.propsJson as object,
      sortOrder,
      isVisible: parsed.data.isVisible ?? true,
    },
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SECTION_CREATED",
    resourceType: "builder_section",
    resourceId: section.id,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { pageId, sectionType: parsed.data.sectionType },
  });

  return NextResponse.json({ section }, { status: 201 });
}

/**
 * POST /api/builder/pages/[pageId]/sections/reorder — Reorder sections in a page
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";

const reorderSchema = z.object({
  sectionIds: z.array(z.string().min(1)),
});

type RouteParams = { params: Promise<{ pageId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const { pageId } = await params;
  const page = await prisma.builderPage.findFirst({
    where: { id: pageId, site: { orgId: auth.auth.orgId } },
    include: { sections: { select: { id: true } } },
  });
  if (!page) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Page not found." } },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const existingIds = new Set(page.sections.map((s) => s.id));
  const requestedIds = parsed.data.sectionIds;

  // Every section in the page must appear exactly once
  if (requestedIds.length !== existingIds.size || !requestedIds.every((id) => existingIds.has(id))) {
    return NextResponse.json(
      { error: { code: "invalid_order", message: "Section IDs must match all sections in the page exactly." } },
      { status: 400 },
    );
  }

  // Batch update sortOrder in a transaction
  await prisma.$transaction(
    requestedIds.map((id, index) =>
      prisma.builderSection.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SECTIONS_REORDERED",
    resourceType: "builder_page",
    resourceId: pageId,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { order: requestedIds },
  });

  return NextResponse.json({ success: true });
}

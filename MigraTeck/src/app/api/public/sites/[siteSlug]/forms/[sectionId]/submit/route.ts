/**
 * POST /api/public/sites/[siteSlug]/forms/[sectionId]/submit — Public form submission
 *
 * This is an unauthenticated endpoint. It resolves the form binding for the
 * given site + section, then routes the submission to MigraIntake or a fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ siteSlug: string; sectionId: string }> };

const MAX_FIELDS = 30;
const MAX_VALUE_LENGTH = 5000;

const submissionSchema = z.record(
  z.string(),
  z.string().max(MAX_VALUE_LENGTH),
).refine((obj) => Object.keys(obj).length <= MAX_FIELDS, {
  message: `Maximum ${MAX_FIELDS} fields allowed.`,
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { siteSlug, sectionId } = await params;

  // Resolve site by slug (must be PUBLISHED)
  const site = await prisma.builderSite.findFirst({
    where: { slug: siteSlug, status: "PUBLISHED" },
    select: { id: true, orgId: true },
  });
  if (!site) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Site not found." } },
      { status: 404 },
    );
  }

  // Resolve section — must belong to this site
  const section = await prisma.builderSection.findFirst({
    where: { id: sectionId, page: { siteId: site.id }, sectionType: "contactForm" },
  });
  if (!section) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Form section not found." } },
      { status: 404 },
    );
  }

  // Parse + validate submission data
  const body = await request.json().catch(() => null);
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid submission.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  // Resolve form binding (if configured)
  const binding = await prisma.builderFormBinding.findUnique({
    where: { siteId_sectionId: { siteId: site.id, sectionId } },
  });

  if (binding?.targetType === "INTAKE") {
    // TODO: Forward to MigraIntake API once integrated
    // For now, store as a fallback record.
    console.log(`[builder:form] Intake submission for site=${siteSlug} section=${sectionId}`, parsed.data);
  } else if (binding?.targetType === "EMAIL" && binding?.targetValue) {
    // TODO: Send email via MigraMail integration
    console.log(`[builder:form] Email submission to=${binding.targetValue} for site=${siteSlug}`, parsed.data);
  } else {
    // Fallback: log submission (no binding configured yet)
    console.log(`[builder:form] Unrouted submission for site=${siteSlug} section=${sectionId}`, parsed.data);
  }

  return NextResponse.json({ success: true, message: "Form submitted successfully." });
}

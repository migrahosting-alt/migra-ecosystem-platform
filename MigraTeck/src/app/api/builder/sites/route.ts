/**
 * GET  /api/builder/sites — List sites for active org
 * POST /api/builder/sites — Create a new site
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export async function GET() {
  const auth = await requireBuilderAuth("builder:read");
  if (!auth.ok) return auth.response;

  const sites = await prisma.builderSite.findMany({
    where: { orgId: auth.auth.orgId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      domain: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { pages: true, deployments: true } },
    },
  });

  return NextResponse.json({ sites });
}

export async function POST(request: NextRequest) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  // Check slug uniqueness
  const existing = await prisma.builderSite.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    return NextResponse.json(
      { error: { code: "slug_taken", message: "Site slug already in use." } },
      { status: 409 },
    );
  }

  const site = await prisma.builderSite.create({
    data: {
      orgId: auth.auth.orgId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      createdById: auth.auth.userId,
      pages: {
        create: {
          title: "Home",
          slug: "home",
          sortOrder: 0,
        },
      },
    },
    include: { pages: true },
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SITE_CREATED",
    resourceType: "builder_site",
    resourceId: site.id,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { name: site.name, slug: site.slug },
  });

  return NextResponse.json({ site }, { status: 201 });
}

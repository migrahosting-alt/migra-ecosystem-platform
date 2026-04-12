import { ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  region: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().min(2).max(80).default("US"),
  serviceArea: z.string().trim().max(240).nullable().optional(),
  primaryPhone: z.string().trim().max(40).nullable().optional(),
  primary: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return NextResponse.json({ error: "No active organization." }, { status: 404 });
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/locations",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/locations",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return { ok: false as const, response: NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } }) };
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (parsed.data.primary) {
    await prisma.migraMarketLocation.updateMany({
      where: { orgId: activeOrg.orgId, primary: true },
      data: { primary: false },
    });
  }

  const location = await prisma.migraMarketLocation.create({
    data: {
      orgId: activeOrg.orgId,
      name: parsed.data.name,
      city: parsed.data.city,
      region: parsed.data.region ?? null,
      country: parsed.data.country,
      serviceArea: parsed.data.serviceArea ?? null,
      primaryPhone: parsed.data.primaryPhone ?? null,
      primary: parsed.data.primary,
    },
  });

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_LOCATION_CREATED",
    resourceType: "migramarket_location",
    resourceId: location.id,
    ip,
    userAgent,
    metadata: {
      name: location.name,
      city: location.city,
      primary: location.primary,
    },
  });

  return NextResponse.json({ location }, { status: 201 });
}

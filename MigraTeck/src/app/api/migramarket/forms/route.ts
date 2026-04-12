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
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/),
  sourceChannel: z.string().trim().min(2).max(80).default("website"),
  destinationEmail: z.string().trim().email().nullable().optional(),
  thankYouMessage: z.string().max(500).nullable().optional(),
  smsConsentEnabled: z.boolean().default(false),
  smsConsentLabel: z.string().trim().max(240).nullable().optional(),
  active: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;
  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult.response;
  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) return NextResponse.json({ error: "No active organization." }, { status: 404 });
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/forms",
    ip,
    userAgent,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/forms",
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  const form = await prisma.migraMarketLeadCaptureForm.create({
    data: {
      orgId: activeOrg.orgId,
      ...parsed.data,
      destinationEmail: parsed.data.destinationEmail ?? null,
      thankYouMessage: parsed.data.thankYouMessage ?? null,
      smsConsentLabel: parsed.data.smsConsentLabel ?? null,
    },
  });
  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_FORM_CREATED",
    resourceType: "migramarket_lead_form",
    resourceId: form.id,
    ip,
    userAgent,
    metadata: { slug: form.slug, active: form.active },
  });
  return NextResponse.json({ form: { ...form, createdAt: form.createdAt.toISOString(), updatedAt: form.updatedAt.toISOString() } }, { status: 201 });
}

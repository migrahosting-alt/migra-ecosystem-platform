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

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/).optional(),
  sourceChannel: z.string().trim().min(2).max(80).optional(),
  destinationEmail: z.string().trim().email().nullable().optional(),
  thankYouMessage: z.string().max(500).nullable().optional(),
  smsConsentEnabled: z.boolean().optional(),
  smsConsentLabel: z.string().trim().max(240).nullable().optional(),
  active: z.boolean().optional(),
});

async function authorize(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult;
  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) return { ok: false as const, response: NextResponse.json({ error: "No active organization." }, { status: 404 }) };
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/forms/[id]",
    ip,
    userAgent,
  });
  if (!allowed) return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/forms/[id]",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return { ok: false as const, response: NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus }) };
    }
    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return { ok: false as const, response: NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } }) };
  }
  return { ok: true as const, authResult, activeOrg, ip, userAgent };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  const existing = await prisma.migraMarketLeadCaptureForm.findFirst({ where: { id, orgId: auth.activeOrg.orgId } });
  if (!existing) return NextResponse.json({ error: "Form not found." }, { status: 404 });
  const updateData = {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.slug !== undefined ? { slug: parsed.data.slug } : {}),
    ...(parsed.data.sourceChannel !== undefined ? { sourceChannel: parsed.data.sourceChannel } : {}),
    ...(parsed.data.destinationEmail !== undefined ? { destinationEmail: parsed.data.destinationEmail } : {}),
    ...(parsed.data.thankYouMessage !== undefined ? { thankYouMessage: parsed.data.thankYouMessage } : {}),
    ...(parsed.data.smsConsentEnabled !== undefined ? { smsConsentEnabled: parsed.data.smsConsentEnabled } : {}),
    ...(parsed.data.smsConsentLabel !== undefined ? { smsConsentLabel: parsed.data.smsConsentLabel } : {}),
    ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
  };
  const form = await prisma.migraMarketLeadCaptureForm.update({
    where: { id },
    data: updateData,
  });
  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "MIGRAMARKET_FORM_UPDATED",
    resourceType: "migramarket_lead_form",
    resourceId: id,
    ip: auth.ip,
    userAgent: auth.userAgent,
    metadata: { fields: Object.keys(parsed.data), active: form.active },
  });
  return NextResponse.json({ form: { ...form, createdAt: form.createdAt.toISOString(), updatedAt: form.updatedAt.toISOString() } });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const existing = await prisma.migraMarketLeadCaptureForm.findFirst({ where: { id, orgId: auth.activeOrg.orgId } });
  if (!existing) return NextResponse.json({ error: "Form not found." }, { status: 404 });
  await prisma.migraMarketLeadCaptureForm.delete({ where: { id } });
  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "MIGRAMARKET_FORM_DELETED",
    resourceType: "migramarket_lead_form",
    resourceId: id,
    ip: auth.ip,
    userAgent: auth.userAgent,
  });
  return NextResponse.json({ ok: true });
}

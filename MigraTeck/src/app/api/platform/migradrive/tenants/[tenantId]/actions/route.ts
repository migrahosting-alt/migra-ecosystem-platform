import { OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { runDrivePreviewRegeneration, runDriveTenantCleanup, runDriveTenantReconciliation } from "@/lib/drive/drive-ops";
import { activateTenant, disableTenant, restrictTenant, updateTenantPlan } from "@/lib/drive/drive-tenant-lifecycle";
import { isPlatformOwner } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { roleAtLeast } from "@/lib/rbac";
import { requireSameOrigin } from "@/lib/security/csrf";

function redirectToTenant(request: NextRequest, tenantId: string, params: Record<string, string>) {
  const url = new URL(`/app/platform/migradrive/tenants/${tenantId}`, request.url);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url);
}

function normalizeString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function POST(request: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const [activeOrg, platformOwner] = await Promise.all([
    getActiveOrgContext(authResult.session.user.id),
    isPlatformOwner(authResult.session.user.id),
  ]);

  if (!platformOwner && !(activeOrg?.role && roleAtLeast(activeOrg.role, OrgRole.ADMIN))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { tenantId } = await context.params;
  const tenant = await prisma.driveTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  if (!platformOwner && activeOrg?.orgId !== tenant.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const action = normalizeString(formData.get("action"));

  try {
    switch (action) {
      case "activate":
        await activateTenant({
          tenantId,
          actorType: "ADMIN",
          actorId: authResult.session.user.id,
          reason: normalizeString(formData.get("reason")),
          metadata: { source: "migradrive_ops_ui" },
        });
        return redirectToTenant(request, tenantId, { result: "tenant_activated" });
      case "restrict":
        await restrictTenant({
          tenantId,
          actorType: "ADMIN",
          actorId: authResult.session.user.id,
          reason: normalizeString(formData.get("reason")) || "manual_restriction",
          metadata: { source: "migradrive_ops_ui" },
        });
        return redirectToTenant(request, tenantId, { result: "tenant_restricted" });
      case "disable":
        await disableTenant({
          tenantId,
          actorType: "ADMIN",
          actorId: authResult.session.user.id,
          reason: normalizeString(formData.get("reason")),
          metadata: { source: "migradrive_ops_ui" },
        });
        return redirectToTenant(request, tenantId, { result: "tenant_disabled" });
      case "update-plan": {
        const planCode = normalizeString(formData.get("planCode"));
        const storageQuotaGbRaw = normalizeString(formData.get("storageQuotaGb"));
        const storageQuotaGb = storageQuotaGbRaw ? Number.parseInt(storageQuotaGbRaw, 10) : NaN;
        if (!planCode || !Number.isFinite(storageQuotaGb) || storageQuotaGb <= 0) {
          return redirectToTenant(request, tenantId, { error: "invalid_plan_update_payload" });
        }

        await updateTenantPlan({
          tenantId,
          planCode,
          storageQuotaGb,
          subscriptionId: normalizeString(formData.get("subscriptionId")) || null,
          entitlementId: normalizeString(formData.get("entitlementId")) || null,
          actorType: "ADMIN",
          actorId: authResult.session.user.id,
          metadata: { source: "migradrive_ops_ui" },
        });
        return redirectToTenant(request, tenantId, { result: "tenant_plan_updated" });
      }
      case "cleanup":
        await runDriveTenantCleanup(tenantId);
        return redirectToTenant(request, tenantId, { result: "tenant_cleanup_completed" });
      case "reconcile":
        await runDriveTenantReconciliation(tenantId);
        return redirectToTenant(request, tenantId, { result: "tenant_reconciled" });
      case "regenerate-previews":
        await runDrivePreviewRegeneration(tenantId);
        return redirectToTenant(request, tenantId, { error: "preview_pipeline_not_configured" });
      default:
        return redirectToTenant(request, tenantId, { error: "unsupported_action" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "drive_ops_action_failed";
    return redirectToTenant(request, tenantId, { error: message });
  }
}
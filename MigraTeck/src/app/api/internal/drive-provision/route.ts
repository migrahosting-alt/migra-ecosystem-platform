import { DriveTenantActorType, DriveTenantStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { appendTenantEvent } from "@/lib/drive/drive-tenant-events";
import {
  recordDriveDisable,
  recordDriveProvisionFailure,
  recordDriveProvisionSuccess,
  recordDriveReactivation,
} from "@/lib/drive/drive-tenant-metrics";

// ── Request schemas ─────────────────────────────────────────

const provisionSchema = z.object({
  idempotencyKey: z.string().min(1),
  orgId: z.string().min(1),
  orgSlug: z.string().min(1),
  planCode: z.string().min(1),
  storageQuotaGb: z.number().positive(),
  subscriptionId: z.string().nullable().optional(),
  entitlementId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
});

const disableSchema = z.object({
  idempotencyKey: z.string().optional(),
  orgId: z.string().min(1),
  reason: z.string().optional(),
});

// ── Auth helper ─────────────────────────────────────────────

function extractBearerToken(request: NextRequest): string {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function authenticate(request: NextRequest): boolean {
  const configured = env.MIGRADRIVE_INTERNAL_PROVISION_TOKEN?.trim();
  if (!configured) return false;
  const supplied = extractBearerToken(request);
  return !!supplied && supplied === configured;
}

// ── POST /api/internal/drive-provision ──────────────────────

export async function POST(request: NextRequest) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = request.nextUrl.pathname.endsWith("/disable") ? "disable" : "provision";
  const idempotencyKey =
    request.headers.get("x-idempotency-key") || (body as Record<string, unknown>).idempotencyKey;

  if (action === "disable") {
    return handleDisable(body, idempotencyKey as string | undefined);
  }

  return handleProvision(body, idempotencyKey as string);
}

// ── Provision handler ───────────────────────────────────────

async function handleProvision(body: unknown, headerIdempotencyKey?: string): Promise<NextResponse> {
  const parsed = provisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { orgId, orgSlug, planCode, storageQuotaGb, subscriptionId, entitlementId, customerId } = parsed.data;
  const idempotencyKey = headerIdempotencyKey || parsed.data.idempotencyKey;

  // ── Verify org exists ───────────────────────────────────
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, slug: true },
  });

  if (!org) {
    recordDriveProvisionFailure({ orgId, reason: "organization_not_found" });
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // ── Idempotency: check for existing tenant ─────────────
  const existing = await prisma.driveTenant.findUnique({ where: { orgId } });

  if (existing && existing.status === DriveTenantStatus.ACTIVE) {
    // Already provisioned — update if plan or quota changed
    if (existing.planCode !== planCode || existing.storageQuotaGb !== storageQuotaGb) {
      const updated = await prisma.driveTenant.update({
        where: { id: existing.id },
        data: {
          planCode,
          storageQuotaGb,
          subscriptionId: subscriptionId || existing.subscriptionId,
          entitlementId: entitlementId || existing.entitlementId,
        },
      });

      await appendTenantEvent({
        tenantId: existing.id,
        orgId,
        action: "TENANT_PLAN_UPDATED",
        previousStatus: DriveTenantStatus.ACTIVE,
        newStatus: DriveTenantStatus.ACTIVE,
        previousPlanCode: existing.planCode,
        newPlanCode: planCode,
        previousQuotaGb: existing.storageQuotaGb,
        newQuotaGb: storageQuotaGb,
        subscriptionId: subscriptionId || null,
        entitlementId: entitlementId || null,
        idempotencyKey,
        actorType: DriveTenantActorType.SYSTEM,
      });

      await writeAuditLog({
        actorId: null,
        orgId,
        action: "DRIVE_TENANT_UPGRADED",
        resourceType: "drive_tenant",
        resourceId: updated.id,
        riskTier: 1,
        metadata: {
          previousPlan: existing.planCode,
          newPlan: planCode,
          previousQuotaGb: existing.storageQuotaGb,
          newQuotaGb: storageQuotaGb,
          idempotencyKey,
        },
      });

      recordDriveProvisionSuccess({ orgId, tenantId: updated.id, result: "upgraded" });

      return NextResponse.json({
        ok: true,
        tenantId: updated.id,
        externalRef: updated.externalRef,
        status: "upgraded",
        planCode: updated.planCode,
        storageQuotaGb: updated.storageQuotaGb,
      });
    }

    // Exact duplicate — idempotent success
    return NextResponse.json(
      {
        ok: true,
        tenantId: existing.id,
        externalRef: existing.externalRef,
        status: "already_provisioned",
        planCode: existing.planCode,
        storageQuotaGb: existing.storageQuotaGb,
      },
      { status: 409 },
    );
  }

  // ── Re-enable a previously non-ACTIVE tenant ───────────
  if (existing && existing.status !== DriveTenantStatus.ACTIVE) {
    const previousStatus = existing.status;
    const reactivated = await prisma.driveTenant.update({
      where: { id: existing.id },
      data: {
        status: DriveTenantStatus.ACTIVE,
        planCode,
        storageQuotaGb,
        orgSlug,
        activatedAt: new Date(),
        disabledAt: null,
        disableReason: null,
        restrictedAt: null,
        restrictionReason: null,
        subscriptionId: subscriptionId || existing.subscriptionId,
        entitlementId: entitlementId || existing.entitlementId,
      },
    });

    await appendTenantEvent({
      tenantId: existing.id,
      orgId,
      action: "TENANT_ACTIVATED",
      previousStatus,
      newStatus: DriveTenantStatus.ACTIVE,
      previousPlanCode: existing.planCode,
      newPlanCode: planCode,
      previousQuotaGb: existing.storageQuotaGb,
      newQuotaGb: storageQuotaGb,
      subscriptionId: subscriptionId || null,
      entitlementId: entitlementId || null,
      idempotencyKey,
      actorType: DriveTenantActorType.SYSTEM,
    });

    await writeAuditLog({
      actorId: null,
      orgId,
      action: "DRIVE_TENANT_REACTIVATED",
      resourceType: "drive_tenant",
      resourceId: reactivated.id,
      riskTier: 1,
      metadata: { previousStatus, planCode, storageQuotaGb, idempotencyKey },
    });

    recordDriveReactivation({ orgId, tenantId: reactivated.id, source: "system" });

    return NextResponse.json({
      ok: true,
      tenantId: reactivated.id,
      externalRef: reactivated.externalRef,
      status: "reactivated",
      planCode: reactivated.planCode,
      storageQuotaGb: reactivated.storageQuotaGb,
    });
  }

  // ── Create new tenant ──────────────────────────────────
  const externalRef = `drive_${orgId}_${Date.now()}`;

  const tenant = await prisma.driveTenant.create({
    data: {
      orgId,
      orgSlug: orgSlug || org.slug,
      planCode,
      storageQuotaGb,
      status: DriveTenantStatus.ACTIVE,
      activatedAt: new Date(),
      externalRef,
      subscriptionId: subscriptionId || null,
      entitlementId: entitlementId || null,
      provisioningJobId: null,
    },
  });

  await appendTenantEvent({
    tenantId: tenant.id,
    orgId,
    action: "TENANT_PROVISIONED",
    newStatus: DriveTenantStatus.ACTIVE,
    newPlanCode: planCode,
    newQuotaGb: storageQuotaGb,
    subscriptionId: subscriptionId || null,
    entitlementId: entitlementId || null,
    idempotencyKey,
    actorType: DriveTenantActorType.SYSTEM,
    metadata: { customerId: customerId || null, externalRef },
  });

  await writeAuditLog({
    actorId: null,
    orgId,
    action: "DRIVE_TENANT_PROVISIONED",
    resourceType: "drive_tenant",
    resourceId: tenant.id,
    riskTier: 1,
    metadata: {
      planCode,
      storageQuotaGb,
      externalRef,
      subscriptionId: subscriptionId || null,
      entitlementId: entitlementId || null,
      customerId: customerId || null,
      idempotencyKey,
    },
  });

  recordDriveProvisionSuccess({ orgId, tenantId: tenant.id, result: "provisioned" });

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    externalRef: tenant.externalRef,
    status: "completed",
    planCode: tenant.planCode,
    storageQuotaGb: tenant.storageQuotaGb,
  });
}

// ── Disable handler ─────────────────────────────────────────

async function handleDisable(body: unknown, idempotencyKey?: string): Promise<NextResponse> {
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { orgId, reason } = parsed.data;

  const tenant = await prisma.driveTenant.findUnique({ where: { orgId } });

  if (!tenant || tenant.status === DriveTenantStatus.DISABLED) {
    return NextResponse.json({ ok: true, status: "already_disabled" }, { status: 409 });
  }

  const previousStatus = tenant.status;
  const disabled = await prisma.driveTenant.update({
    where: { id: tenant.id },
    data: {
      status: DriveTenantStatus.DISABLED,
      disabledAt: new Date(),
      disableReason: reason || null,
    },
  });

  await appendTenantEvent({
    tenantId: tenant.id,
    orgId,
    action: "TENANT_DISABLED",
    previousStatus,
    newStatus: DriveTenantStatus.DISABLED,
    idempotencyKey,
    actorType: DriveTenantActorType.SYSTEM,
    metadata: { reason: reason || null },
  });

  await writeAuditLog({
    actorId: null,
    orgId,
    action: "DRIVE_TENANT_DISABLED",
    resourceType: "drive_tenant",
    resourceId: disabled.id,
    riskTier: 2,
    metadata: {
      planCode: disabled.planCode,
      storageQuotaGb: disabled.storageQuotaGb,
      reason: reason || null,
      idempotencyKey: idempotencyKey || null,
    },
  });

  recordDriveDisable({ orgId, tenantId: disabled.id, source: "system" });

  return NextResponse.json({
    ok: true,
    tenantId: disabled.id,
    status: "disabled",
  });
}

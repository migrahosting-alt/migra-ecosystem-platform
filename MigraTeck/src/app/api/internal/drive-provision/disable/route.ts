import { DriveTenantActorType, DriveTenantStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { appendTenantEvent } from "@/lib/drive/drive-tenant-events";
import { recordDriveDisable } from "@/lib/drive/drive-tenant-metrics";

const disableSchema = z.object({
  idempotencyKey: z.string().optional(),
  orgId: z.string().min(1),
  reason: z.string().optional(),
});

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

export async function POST(request: NextRequest) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { orgId, reason } = parsed.data;
  const idempotencyKey = request.headers.get("x-idempotency-key") || (body as Record<string, unknown>).idempotencyKey;

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
    idempotencyKey: idempotencyKey as string | undefined,
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

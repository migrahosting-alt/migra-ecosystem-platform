import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { updateTenantPlan } from "@/lib/drive/drive-tenant-lifecycle";
import { serializeDriveTenant } from "@/lib/drive/drive-tenant-serializers";

const requestSchema = z.object({
  planCode: z.string().min(1),
  storageQuotaGb: z.number().positive(),
  subscriptionId: z.string().nullable().optional(),
  entitlementId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  actorId: z.string().optional(),
  traceId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { tenantId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const result = await updateTenantPlan({
    tenantId,
    planCode: parsed.data.planCode,
    storageQuotaGb: parsed.data.storageQuotaGb,
    subscriptionId: parsed.data.subscriptionId,
    entitlementId: parsed.data.entitlementId,
    actorType: "ADMIN",
    actorId: parsed.data.actorId,
    traceId: parsed.data.traceId,
    idempotencyKey: parsed.data.idempotencyKey,
    metadata: parsed.data.metadata,
  });

  return NextResponse.json({ ok: true, tenant: serializeDriveTenant(result.tenant) });
}

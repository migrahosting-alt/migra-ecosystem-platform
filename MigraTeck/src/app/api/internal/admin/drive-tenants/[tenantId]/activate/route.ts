import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { activateTenant } from "@/lib/drive/drive-tenant-lifecycle";
import { serializeDriveTenant } from "@/lib/drive/drive-tenant-serializers";

const requestSchema = z.object({
  reason: z.string().max(200).optional(),
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
  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await activateTenant({
    tenantId,
    actorType: "ADMIN",
    actorId: parsed.data.actorId,
    traceId: parsed.data.traceId,
    idempotencyKey: parsed.data.idempotencyKey,
    reason: parsed.data.reason,
    metadata: parsed.data.metadata,
  });

  return NextResponse.json({ ok: true, changed: result.changed, tenant: serializeDriveTenant(result.tenant) });
}

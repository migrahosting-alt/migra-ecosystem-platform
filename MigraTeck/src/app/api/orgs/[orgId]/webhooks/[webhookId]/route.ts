import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/org-context";
import { deleteWebhookEndpoint, updateWebhookEndpoint } from "@/lib/webhooks";
import { requireSameOrigin } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";

const updateSchema = z.object({
  url: z.string().url().max(2000).optional(),
  events: z.array(z.string().max(100)).max(50).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ orgId: string; webhookId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const result = await requireOrgContext(request, { params: context.params.then((p) => ({ orgId: p.orgId })) }, {
    minRole: ["OWNER", "ADMIN"],
  });
  if (!result.ok) return result.response;

  const { webhookId } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const updated = await updateWebhookEndpoint(result.ctx.orgId, webhookId, parsed.data);

  if (updated.count === 0) {
    return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  }

  await writeAuditLog({
    userId: result.ctx.userId,
    orgId: result.ctx.orgId,
    action: "WEBHOOK_ENDPOINT_UPDATED",
    entityType: "webhook_endpoint",
    entityId: webhookId,
    ip: result.ctx.ip,
    userAgent: result.ctx.userAgent,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ orgId: string; webhookId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const result = await requireOrgContext(request, { params: context.params.then((p) => ({ orgId: p.orgId })) }, {
    minRole: ["OWNER", "ADMIN"],
  });
  if (!result.ok) return result.response;

  const { webhookId } = await context.params;
  const deleted = await deleteWebhookEndpoint(result.ctx.orgId, webhookId);

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  }

  await writeAuditLog({
    userId: result.ctx.userId,
    orgId: result.ctx.orgId,
    action: "WEBHOOK_ENDPOINT_DELETED",
    entityType: "webhook_endpoint",
    entityId: webhookId,
    ip: result.ctx.ip,
    userAgent: result.ctx.userAgent,
  });

  return NextResponse.json({ ok: true });
}

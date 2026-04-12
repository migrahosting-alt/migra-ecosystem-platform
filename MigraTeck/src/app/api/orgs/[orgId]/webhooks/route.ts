import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/org-context";
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
} from "@/lib/webhooks";
import { requireSameOrigin } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  url: z.string().url().max(2000),
  events: z.array(z.string().max(100)).max(50).default([]),
  description: z.string().max(500).optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orgId: string }> },
) {
  const result = await requireOrgContext(request, context, {
    minRole: ["OWNER", "ADMIN"],
  });
  if (!result.ok) return result.response;

  const endpoints = await listWebhookEndpoints(result.ctx.orgId);
  return NextResponse.json({ endpoints });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orgId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const result = await requireOrgContext(request, context, {
    minRole: ["OWNER", "ADMIN"],
  });
  if (!result.ok) return result.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const endpoint = await createWebhookEndpoint({
    orgId: result.ctx.orgId,
    url: parsed.data.url,
    events: parsed.data.events,
    description: parsed.data.description,
  });

  await writeAuditLog({
    userId: result.ctx.userId,
    orgId: result.ctx.orgId,
    action: "WEBHOOK_ENDPOINT_CREATED",
    entityType: "webhook_endpoint",
    entityId: endpoint.id,
    ip: result.ctx.ip,
    userAgent: result.ctx.userAgent,
    metadata: { url: parsed.data.url },
  });

  return NextResponse.json(
    {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      status: endpoint.status,
      // Secret shown only at creation time
      secret: endpoint.secret,
      createdAt: endpoint.createdAt,
    },
    { status: 201 },
  );
}

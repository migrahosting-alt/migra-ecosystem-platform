import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { executeVpsAction } from "@/lib/vps/actions";
import { legacyActionErrorResponse, prepareServerMutationRequest } from "@/lib/vps/handlers";
import { prisma } from "@/lib/prisma";
import { getSupportedVpsImage } from "@/lib/vps/images";

const bodySchema = z.object({
  confirmText: z.string().min(1),
  imageSlug: z.string().min(1).optional(),
  reason: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const prepared = await prepareServerMutationRequest({
    request,
    params: context.params,
    rateLimit: {
      action: "vps:rebuild",
      maxAttempts: 4,
      windowSeconds: 60 * 60,
    },
  });
  if (prepared instanceof Response) {
    return prepared;
  }

  const server = await prisma.vpsServer.findFirst({
    where: {
      id: prepared.serverId,
      orgId: prepared.actor.orgId,
    },
    select: {
      id: true,
      name: true,
      hostname: true,
    },
  });

  if (!server) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404 });
  }

  if (parsed.data.confirmText !== server.name && parsed.data.confirmText !== server.hostname) {
    return NextResponse.json({ error: "Confirmation text must match the server name or hostname." }, { status: 400 });
  }

  if (parsed.data.imageSlug && !getSupportedVpsImage(parsed.data.imageSlug)) {
    return NextResponse.json({ error: "Selected operating system image is not supported." }, { status: 400 });
  }

  try {
    const result = await executeVpsAction({
      membership: prepared.actor.membership,
      serverId: prepared.serverId,
      action: "REBUILD",
      actorUserId: prepared.actor.userId,
      actorRole: prepared.actor.role,
      ip: prepared.ip,
      userAgent: prepared.userAgent,
      requestPayload: {
        confirmText: parsed.data.confirmText,
        imageSlug: parsed.data.imageSlug || null,
        reason: parsed.data.reason || null,
      },
      rebuildInput: {
        ...(parsed.data.imageSlug ? { imageSlug: parsed.data.imageSlug } : {}),
        ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return legacyActionErrorResponse(error, "Rebuild failed.");
  }
}

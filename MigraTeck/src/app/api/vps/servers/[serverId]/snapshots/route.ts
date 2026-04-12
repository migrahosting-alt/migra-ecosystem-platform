import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { getClientIp } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { handleServerAction } from "@/lib/vps/handlers";
import { assertProviderCapability } from "@/lib/vps/provider-support";
import { getServerProviderContext } from "@/lib/vps/queries";
import { getVpsProviderAdapter } from "@/lib/vps/providers";
import { listVpsSnapshots } from "@/lib/vps/data";

const createSnapshotSchema = z.object({
  name: z.string().min(1).max(100),
});

export const GET = safeApiHandler(async function GET(
  _request: Request,
  context: { params: Promise<{ serverId: string }> },
) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) {
    return NextResponse.json({ error: "No active organization context." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const { serverId } = await context.params;
  const server = await getServerProviderContext(serverId, membership.orgId);
  if (!server) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const provider = getVpsProviderAdapter(server.providerSlug);
  assertProviderCapability({ providerSlug: server.providerSlug, capabilities: provider.capabilities, capability: "snapshots" });

  const snapshots = await listVpsSnapshots(serverId, membership.orgId);

  if (!snapshots) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ snapshots }, { headers: { "Cache-Control": "no-store" } });
});

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) {
    return NextResponse.json({ error: "No active organization context." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSnapshotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid snapshot request.", details: parsed.error.flatten() }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { serverId } = await context.params;
  const limiter = await assertRateLimit({
    key: `${authResult.session.user.id}:${membership.orgId}:${serverId}:${ip}`,
    action: "vps:snapshots:create",
    maxAttempts: 10,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } });
  }

  return handleServerAction({
    actor: {
      userId: authResult.session.user.id,
      orgId: membership.orgId,
      role: membership.role,
      sourceIp: ip,
      membership,
    },
    serverId,
    actionType: "CREATE_SNAPSHOT",
    allowedRoles: ["OWNER", "ADMIN", "OPERATOR"],
    eventType: "SNAPSHOT_CREATE_REQUESTED",
    severity: "WARNING",
    requestJson: parsed.data,
  });
}


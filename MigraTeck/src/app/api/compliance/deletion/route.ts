import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  requestDataDeletion,
  listDeletionRequests,
  approveDeletion,
  executeDeletion,
  cancelDeletion,
  getDeletionCertificate,
} from "@/lib/data-deletion";

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const certId = searchParams.get("certId");

  if (certId) {
    const cert = await getDeletionCertificate(certId);
    return NextResponse.json({ certificate: cert });
  }

  const status = searchParams.get("status") as "REQUESTED" | "APPROVED" | "COMPLETED" | undefined;
  const requests = await listDeletionRequests(ctx.orgId, status ?? undefined);
  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { subjectEmail, subjectUserId, scope, categories, reason } = body as {
    subjectEmail: string;
    subjectUserId?: string;
    scope?: string;
    categories?: string[];
    reason?: string;
  };

  if (!subjectEmail) {
    return NextResponse.json({ error: "subjectEmail required" }, { status: 400 });
  }

  const req = await requestDataDeletion({
    orgId: ctx.orgId,
    requestedById: auth.session.user.id,
    subjectEmail,
    subjectUserId,
    scope,
    categories: categories ?? ["audit", "usage", "notifications", "personal"],
    reason,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "DATA_DELETION_REQUESTED",
    resourceType: "DataDeletionRequest",
    resourceId: req.id,
    riskTier: 2,
    metadata: { subjectEmail } as Prisma.InputJsonValue,
  });

  return NextResponse.json({ request: req }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { requestId, action: reqAction } = body as { requestId: string; action: string };

  if (!requestId || !reqAction) {
    return NextResponse.json({ error: "requestId and action required" }, { status: 400 });
  }

  if (reqAction === "approve") {
    const result = await approveDeletion(requestId, auth.session.user.id);
    await writeAuditLog({
      actorId: auth.session.user.id,
      orgId: ctx.orgId,
      action: "DATA_DELETION_APPROVED",
      resourceType: "DataDeletionRequest",
      resourceId: requestId,
      riskTier: 2,
    });
    return NextResponse.json({ request: result });
  }

  if (reqAction === "execute") {
    const result = await executeDeletion(requestId);
    await writeAuditLog({
      actorId: auth.session.user.id,
      orgId: ctx.orgId,
      action: "DATA_DELETION_EXECUTED",
      resourceType: "DataDeletionRequest",
      resourceId: requestId,
      riskTier: 2,
      metadata: result as Prisma.InputJsonValue,
    });
    return NextResponse.json({ result });
  }

  if (reqAction === "cancel") {
    const result = await cancelDeletion(requestId);
    return NextResponse.json({ request: result });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

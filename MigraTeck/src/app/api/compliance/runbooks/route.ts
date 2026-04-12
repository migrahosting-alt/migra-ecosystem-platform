import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  createRunbook,
  listRunbooks,
  getRunbook,
  updateRunbook,
  markRunbookReviewed,
  getRunbooksDueForReview,
} from "@/lib/compliance-runbooks";

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const dueForReview = searchParams.get("dueForReview");
  const category = searchParams.get("category");

  if (slug) {
    const runbook = await getRunbook(slug);
    return NextResponse.json({ runbook });
  }

  if (dueForReview === "true") {
    const runbooks = await getRunbooksDueForReview();
    return NextResponse.json({ runbooks });
  }

  const runbooks = await listRunbooks(category ?? undefined);
  return NextResponse.json({ runbooks });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { title, slug, category, content } = body as {
    title: string;
    slug: string;
    category: string;
    content: string;
  };

  if (!title || !slug || !category || !content) {
    return NextResponse.json({ error: "title, slug, category, content required" }, { status: 400 });
  }

  const runbook = await createRunbook({
    title,
    slug,
    category,
    content,
    ownerId: auth.session.user.id,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "COMPLIANCE_RUNBOOK_CREATED",
    resourceType: "ComplianceRunbook",
    resourceId: runbook.id,
    riskTier: 1,
  });

  return NextResponse.json({ runbook }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "compliance:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { runbookId, action: rbAction, ...updates } = body as {
    runbookId: string;
    action?: string;
    title?: string;
    content?: string;
    category?: string;
    isPublished?: boolean;
  };

  if (!runbookId) {
    return NextResponse.json({ error: "runbookId required" }, { status: 400 });
  }

  if (rbAction === "markReviewed") {
    const result = await markRunbookReviewed(runbookId);
    await writeAuditLog({
      actorId: auth.session.user.id,
      orgId: ctx.orgId,
      action: "COMPLIANCE_RUNBOOK_REVIEWED",
      resourceType: "ComplianceRunbook",
      resourceId: runbookId,
      riskTier: 0,
    });
    return NextResponse.json({ runbook: result });
  }

  const updated = await updateRunbook(runbookId, updates);

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "COMPLIANCE_RUNBOOK_UPDATED",
    resourceType: "ComplianceRunbook",
    resourceId: runbookId,
    riskTier: 1,
  });

  return NextResponse.json({ runbook: updated });
}

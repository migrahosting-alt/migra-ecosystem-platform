import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  createAccessReview,
  listAccessReviews,
  getAccessReview,
  submitReviewDecision,
  completeAccessReview,
  applyReviewDecisions,
  generateAccessReviewReport,
} from "@/lib/access-review";

export async function GET(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "access-review:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const reviewId = searchParams.get("reviewId");
  const report = searchParams.get("report");

  if (reviewId && report === "true") {
    const reviewReport = await generateAccessReviewReport(reviewId);
    return NextResponse.json({ report: reviewReport });
  }

  if (reviewId) {
    const review = await getAccessReview(reviewId);
    return NextResponse.json({ review });
  }

  const reviews = await listAccessReviews(ctx.orgId);
  return NextResponse.json({ reviews });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "access-review:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { title, description, dueDate } = body as {
    title: string;
    description?: string;
    dueDate: string;
  };

  if (!title || !dueDate) {
    return NextResponse.json({ error: "title and dueDate required" }, { status: 400 });
  }

  const review = await createAccessReview({
    orgId: ctx.orgId,
    title,
    description,
    initiatedById: auth.session.user.id,
    dueDate: new Date(dueDate),
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "ACCESS_REVIEW_CREATED",
    resourceType: "AccessReview",
    resourceId: review.id,
    riskTier: 1,
  });

  return NextResponse.json({ review }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "access-review:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { action: reviewAction, reviewId, entryId, decision, notes } = body as {
    action: string;
    reviewId?: string;
    entryId?: string;
    decision?: string;
    notes?: string;
  };

  if (reviewAction === "decide" && entryId && decision) {
    const entry = await submitReviewDecision({
      entryId,
      decision: decision as "KEEP" | "REVOKE" | "DOWNGRADE",
      decidedById: auth.session.user.id,
      notes,
    });
    return NextResponse.json({ entry });
  }

  if (reviewAction === "complete" && reviewId) {
    const result = await completeAccessReview(reviewId);
    await writeAuditLog({
      actorId: auth.session.user.id,
      orgId: ctx.orgId,
      action: "ACCESS_REVIEW_COMPLETED",
      resourceType: "AccessReview",
      resourceId: reviewId,
      riskTier: 1,
    });
    return NextResponse.json({ review: result });
  }

  if (reviewAction === "apply" && reviewId) {
    const result = await applyReviewDecisions(reviewId);
    await writeAuditLog({
      actorId: auth.session.user.id,
      orgId: ctx.orgId,
      action: "ACCESS_REVIEW_DECISIONS_APPLIED",
      resourceType: "AccessReview",
      resourceId: reviewId,
      riskTier: 2,
      metadata: result as Prisma.InputJsonValue,
    });
    return NextResponse.json({ result });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

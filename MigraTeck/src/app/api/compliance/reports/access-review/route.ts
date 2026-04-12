import { NextResponse } from "next/server";
import { generateAccessReviewReport, getOverdueReviews, listAccessReviews } from "@/lib/access-review";
import { requireComplianceReportPermission } from "@/lib/compliance/report-auth";

export async function GET(request: Request) {
  const auth = await requireComplianceReportPermission("access-review:read");
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const reviewId = searchParams.get("reviewId");

  if (reviewId) {
    const report = await generateAccessReviewReport(reviewId);
    if (report.orgId !== auth.ctx.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      report,
    });
  }

  const [reviews, overdue] = await Promise.all([
    listAccessReviews(auth.ctx.orgId),
    getOverdueReviews(),
  ]);
  const orgOverdue = overdue.filter((review) => review.org.id === auth.ctx.orgId);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    summary: {
      total: reviews.length,
      open: reviews.filter((review) => review.status === "OPEN").length,
      inProgress: reviews.filter((review) => review.status === "IN_PROGRESS").length,
      completed: reviews.filter((review) => review.status === "COMPLETED").length,
      overdue: orgOverdue.length,
    },
    reviews,
    overdue: orgOverdue,
  });
}
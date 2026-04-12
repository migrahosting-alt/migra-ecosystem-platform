import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import {
  createReferralCode,
  listReferralCodes,
  getPartnerStats,
  listConversions,
} from "@/lib/partners";

export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization." }, { status: 403 });
  }

  const url = new URL(request.url);
  const view = url.searchParams.get("view"); // "codes" | "stats" | "conversions"

  if (view === "stats") {
    const stats = await getPartnerStats(ctx.orgId);
    return NextResponse.json(stats);
  }

  if (view === "conversions") {
    const conversions = await listConversions(ctx.orgId);
    return NextResponse.json({ conversions });
  }

  const codes = await listReferralCodes(ctx.orgId);
  return NextResponse.json({ codes });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization." }, { status: 403 });
  }

  const body = await request.json();

  const code = await createReferralCode({
    partnerId: ctx.orgId,
    description: body.description,
    commissionPct: body.commissionPct,
    maxUses: body.maxUses,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
  });

  return NextResponse.json({ code }, { status: 201 });
}

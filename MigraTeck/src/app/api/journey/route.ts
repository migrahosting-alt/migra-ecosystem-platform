import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { getJourney, recalculateJourney } from "@/lib/customer-journey";

export async function GET(_request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization." }, { status: 403 });
  }

  const journey = await getJourney(ctx.orgId);
  return NextResponse.json({ journey });
}

export async function POST(_request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization." }, { status: 403 });
  }

  const journey = await recalculateJourney(ctx.orgId);
  return NextResponse.json({ journey });
}

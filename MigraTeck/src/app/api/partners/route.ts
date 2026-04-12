import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import {
  applyForPartner,
  getPartnerBinding,
  listPartners,
  approvePartner,
  suspendPartner,
  revokePartner,
} from "@/lib/partners";
import { PartnerTier, PartnerStatus, Prisma } from "@prisma/client";

// GET: admin lists all partners, or user gets own partner binding
export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization." }, { status: 403 });
  }

  const url = new URL(request.url);
  const isAdmin = can(ctx.role, "platform:config:manage");

  if (isAdmin && url.searchParams.get("all") === "true") {
    const status = url.searchParams.get("status") as PartnerStatus | null;
    const partners = await listPartners(status ?? undefined);
    return NextResponse.json({ partners });
  }

  const binding = await getPartnerBinding(ctx.orgId);
  return NextResponse.json({ partner: binding });
}

// POST: apply for partner program
export async function POST(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization." }, { status: 403 });
  }

  const body = await request.json();

  const binding = await applyForPartner({
    orgId: ctx.orgId,
    tier: body.tier as PartnerTier | undefined,
    companyName: body.companyName,
    contactEmail: body.contactEmail,
    commissionPct: body.commissionPct,
    metadata: body.metadata as Prisma.InputJsonValue | undefined,
  });

  return NextResponse.json({ partner: binding }, { status: 201 });
}

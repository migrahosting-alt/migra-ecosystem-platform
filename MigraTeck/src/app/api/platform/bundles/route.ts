import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import {
  createBundlePlan,
  updateBundlePlan,
  deleteBundlePlan,
  getPublicBundles,
} from "@/lib/billing/bundles";
import { ProductKey } from "@prisma/client";

export async function GET(_request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Admin gets all bundles (not just public)
  const { prisma } = await import("@/lib/prisma");
  const bundles = await prisma.bundlePlan.findMany({
    orderBy: [{ sortOrder: "asc" }, { priceAmountCents: "asc" }],
  });

  return NextResponse.json({ bundles });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const bundle = await createBundlePlan({
    name: body.name,
    slug: body.slug,
    products: body.products as ProductKey[],
    priceAmountCents: body.priceAmountCents,
    savingsPercent: body.savingsPercent,
    stripePriceId: body.stripePriceId,
    intervalMonths: body.intervalMonths,
    features: body.features,
    trialDays: body.trialDays,
    isPublic: body.isPublic,
    sortOrder: body.sortOrder,
  });

  return NextResponse.json({ bundle }, { status: 201 });
}

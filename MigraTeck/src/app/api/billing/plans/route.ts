import { NextRequest, NextResponse } from "next/server";
import { getPublicPlans } from "@/lib/billing/plans";
import { ProductKey } from "@prisma/client";

export async function GET(request: NextRequest) {
  const product = request.nextUrl.searchParams.get("product") as ProductKey | null;
  const plans = await getPublicPlans(product ?? undefined);

  return NextResponse.json({
    plans: plans.map((p) => ({
      id: p.id,
      product: p.product,
      name: p.name,
      slug: p.slug,
      intervalMonths: p.intervalMonths,
      priceAmountCents: p.priceAmountCents,
      currency: p.currency,
      features: p.features,
      trialDays: p.trialDays,
    })),
  });
}

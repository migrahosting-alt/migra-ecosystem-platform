import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getPublicBundles, calculateBundleSavings } from "@/lib/billing/bundles";
import { ProductKey } from "@prisma/client";

export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const compare = url.searchParams.get("compare"); // comma-separated products

  if (compare) {
    const products = compare.split(",").filter(Boolean) as ProductKey[];
    const savings = await calculateBundleSavings(products);
    return NextResponse.json({ savings });
  }

  const bundles = await getPublicBundles();
  return NextResponse.json({ bundles });
}

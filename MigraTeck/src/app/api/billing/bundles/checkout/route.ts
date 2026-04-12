import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { createBundleCheckout } from "@/lib/billing/bundles";

export async function POST(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization." }, { status: 403 });
  }

  const body = await request.json();

  const result = await createBundleCheckout({
    orgId: ctx.orgId,
    bundleSlug: body.bundleSlug,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
    customerEmail: body.customerEmail,
  });

  return NextResponse.json(result);
}

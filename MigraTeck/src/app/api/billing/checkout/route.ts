import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { getStripe } from "@/lib/billing/stripe-client";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { env, stripeBillingEnabled } from "@/lib/env";
import { getClientIp, getUserAgent } from "@/lib/request";
import { assertRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: ip,
    action: "billing:checkout:create",
    maxAttempts: 10,
    windowSeconds: 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  if (!stripeBillingEnabled) {
    return NextResponse.json({ error: "Billing is not enabled." }, { status: 503 });
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const activeOrg = await getActiveOrgContext(actorUserId);

  if (!activeOrg) {
    return NextResponse.json({ error: "No organization context." }, { status: 400 });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "billing:manage",
    route: "/api/billing/checkout",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { priceId: string; product?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { priceId } = body;
  if (!priceId || typeof priceId !== "string") {
    return NextResponse.json({ error: "priceId is required." }, { status: 400 });
  }

  const stripe = getStripe();

  // Find or create Stripe customer for this org
  let customer = await prisma.billingCustomer.findFirst({
    where: { orgId: activeOrg.orgId, provider: "STRIPE" },
  });

  if (!customer) {
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { email: true, name: true },
    });

    const stripeCustomer = await stripe.customers.create({
      ...(user?.email ? { email: user.email } : {}),
      ...(activeOrg.org.name || user?.name ? { name: activeOrg.org.name || user?.name || "" } : {}),
      metadata: {
        orgId: activeOrg.orgId,
        orgSlug: activeOrg.org.slug || "",
        platform: "migrateck",
      },
    });

    customer = await prisma.billingCustomer.create({
      data: {
        orgId: activeOrg.orgId,
        provider: "STRIPE",
        externalCustomerId: stripeCustomer.id,
        email: user?.email || null,
        metadata: { source: "checkout" },
      },
    });
  }

  const baseUrl = env.NEXTAUTH_URL || "https://migrateck.com";

  const session = await stripe.checkout.sessions.create({
    customer: customer.externalCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/app/billing?checkout=cancelled`,
    subscription_data: {
      metadata: {
        orgId: activeOrg.orgId,
        orgSlug: activeOrg.org.slug || "",
      },
      trial_period_days: 14,
    },
    allow_promotion_codes: true,
  });

  await writeAuditLog({
    actorId: actorUserId,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "BILLING_CHECKOUT_INITIATED",
    resourceType: "billing_checkout",
    resourceId: session.id,
    riskTier: 1,
    ip,
    userAgent,
    metadata: {
      priceId,
      stripeSessionId: session.id,
    },
  });

  return NextResponse.json({ url: session.url });
}

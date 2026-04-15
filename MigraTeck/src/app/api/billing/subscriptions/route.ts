import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { getActiveOrgContext } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { ensureBillingCustomer } from "@/lib/billing/customers";
import { createOrgSubscription } from "@/lib/billing/subscriptions";
import { stripeBillingEnabled } from "@/lib/env";

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const activeOrg = await getActiveOrgContext(actorUserId);

  if (!activeOrg) {
    return NextResponse.json({ subscriptions: [] });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "billing:manage",
    route: "/api/billing/subscriptions",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const subscriptions = await prisma.billingSubscription.findMany({
    where: {
      orgId: activeOrg.orgId,
    },
    orderBy: { createdAt: "desc" },
  });

  await writeAuditLog({
    actorId: actorUserId,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "BILLING_SUBSCRIPTIONS_VIEWED",
    resourceType: "billing_subscription",
    riskTier: 0,
    ip,
    userAgent,
    metadata: {
      count: subscriptions.length,
    },
  });

  return NextResponse.json({ subscriptions });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  if (!stripeBillingEnabled) {
    return NextResponse.json({ error: "Billing unavailable." }, { status: 503 });
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult.response;

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
    route: "/api/billing/subscriptions",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { billingPriceId } = body as { billingPriceId: string };

  if (!billingPriceId || typeof billingPriceId !== "string") {
    return NextResponse.json({ error: "billingPriceId is required." }, { status: 400 });
  }

  // Guard: resolve the price first to validate it exists before creating a customer
  const price = await prisma.billingPrice.findUnique({
    where: { id: billingPriceId },
    include: { product: true },
  });

  if (!price || !price.active || !price.stripePriceId) {
    return NextResponse.json({ error: "Price not available." }, { status: 422 });
  }

  // Guard: prevent duplicate active/trialing subscription for the same product
  const existingActive = await prisma.billingSubscription.findFirst({
    where: {
      orgId: activeOrg.orgId,
      billingPriceId: price.id,
      status: { in: ["ACTIVE", "TRIALING", "INCOMPLETE"] },
    },
  });

  if (existingActive) {
    return NextResponse.json(
      {
        error: "An active subscription already exists for this plan.",
        subscriptionId: existingActive.id,
        status: existingActive.status,
      },
      { status: 409 },
    );
  }

  const email = authResult.session.user.email ?? "";

  const customer = await ensureBillingCustomer({
    orgId: activeOrg.orgId,
    userId: actorUserId,
    email,
  });

  if (!customer.stripeCustomerId) {
    return NextResponse.json({ error: "Stripe customer not provisioned." }, { status: 500 });
  }

  const result = await createOrgSubscription({
    orgId: activeOrg.orgId,
    billingCustomerId: customer.id,
    stripeCustomerId: customer.stripeCustomerId,
    billingPriceId,
  });

  const requiresPaymentConfirmation = result.clientSecret !== null;

  await writeAuditLog({
    actorId: actorUserId,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "BILLING_SUBSCRIPTION_CREATED",
    resourceType: "billing_subscription",
    resourceId: result.subscription.id,
    riskTier: 1,
    ip,
    userAgent,
    metadata: {
      billingPriceId,
      priceCode: price.code,
      productId: price.productId,
      status: result.subscription.status,
      requiresPaymentConfirmation,
    },
  });

  // Distinct audit for trial vs payment-required paths
  if (!requiresPaymentConfirmation) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: activeOrg.role,
      orgId: activeOrg.orgId,
      action: "BILLING_TRIAL_STARTED",
      resourceType: "billing_subscription",
      resourceId: result.subscription.id,
      riskTier: 1,
      ip,
      userAgent,
      metadata: { billingPriceId, priceCode: price.code },
    });
  } else {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: activeOrg.role,
      orgId: activeOrg.orgId,
      action: "BILLING_PAYMENT_CONFIRMATION_REQUIRED",
      resourceType: "billing_subscription",
      resourceId: result.subscription.id,
      riskTier: 1,
      ip,
      userAgent,
      metadata: { billingPriceId, priceCode: price.code },
    });
  }

  return NextResponse.json({
    subscription: result.subscription,
    clientSecret: result.clientSecret,
    requiresPaymentConfirmation,
  });
}

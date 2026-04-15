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
    action: "billing:portal:create",
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
    route: "/api/billing/portal",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const customer = await prisma.billingCustomer.findFirst({
    where: { orgId: activeOrg.orgId, provider: "STRIPE" },
  });

  if (!customer) {
    return NextResponse.json({ error: "No billing customer found. Subscribe to a plan first." }, { status: 404 });
  }

  const stripe = getStripe();
  const baseUrl = env.NEXTAUTH_URL || "https://migrateck.com";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customer.stripeCustomerId,
    return_url: `${baseUrl}/app/billing`,
  });

  await writeAuditLog({
    actorId: actorUserId,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "BILLING_PORTAL_OPENED",
    resourceType: "billing_portal",
    resourceId: portalSession.id,
    riskTier: 1,
    ip,
    userAgent,
  });

  return NextResponse.json({ url: portalSession.url });
}

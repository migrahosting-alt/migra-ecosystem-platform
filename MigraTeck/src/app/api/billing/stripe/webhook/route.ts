import { NextRequest, NextResponse } from "next/server";
import { processStripeWebhookSdk } from "@/lib/billing/webhooks";
import { writeAuditLog } from "@/lib/audit";
import { stripeBillingEnabled, env } from "@/lib/env";
import { getClientIp, getUserAgent } from "@/lib/request";
import { assertRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: ip,
    action: "billing:stripe:webhook",
    maxAttempts: 300,
    windowSeconds: 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  if (!stripeBillingEnabled || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Billing webhook unavailable." }, { status: 503 });
  }

  const signatureHeader = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signatureHeader) {
    await writeAuditLog({
      action: "BILLING_EVENT_REJECTED",
      resourceType: "billing_webhook",
      resourceId: "stripe",
      ip,
      userAgent,
      riskTier: 1,
      metadata: { reason: "missing_signature" },
    });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await processStripeWebhookSdk(rawBody, signatureHeader);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "unknown_error";
    await writeAuditLog({
      action: "BILLING_EVENT_REJECTED",
      resourceType: "billing_webhook",
      resourceId: "stripe",
      ip,
      userAgent,
      riskTier: 1,
      metadata: { reason },
    });
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 400 });
  }

  return NextResponse.json({ received: true });
}

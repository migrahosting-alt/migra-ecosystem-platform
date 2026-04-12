import { NextRequest, NextResponse } from "next/server";
import { processStripeEvent } from "@/lib/billing/subscription-sync";
import { parseStripeEvent, verifyStripeWebhookSignature } from "@/lib/billing/stripe";
import { writeAuditLog } from "@/lib/audit";
import { env, stripeBillingEnabled } from "@/lib/env";
import { getClientIp, getUserAgent } from "@/lib/request";
import { assertRateLimit } from "@/lib/security/rate-limit";

function stripeKeyMode(secretKey: string | undefined): "test" | "live" | null {
  if (!secretKey) {
    return null;
  }

  if (secretKey.startsWith("sk_test_")) {
    return "test";
  }

  if (secretKey.startsWith("sk_live_")) {
    return "live";
  }

  return null;
}

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

  if (!signatureHeader || !verifyStripeWebhookSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET)) {
    await writeAuditLog({
      action: "BILLING_EVENT_REJECTED",
      resourceType: "billing_webhook",
      resourceId: "stripe",
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        reason: "invalid_signature",
      },
    });

    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const event = parseStripeEvent(rawBody);

  if (!event) {
    await writeAuditLog({
      action: "BILLING_EVENT_REJECTED",
      resourceType: "billing_webhook",
      resourceId: "stripe",
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        reason: "invalid_payload",
      },
    });

    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const keyMode = stripeKeyMode(env.STRIPE_SECRET_KEY);
  if (keyMode && typeof event.livemode === "boolean") {
    const eventMode = event.livemode ? "live" : "test";
    if (keyMode !== eventMode) {
      await writeAuditLog({
        action: "BILLING_EVENT_REJECTED",
        resourceType: "billing_webhook",
        resourceId: event.id,
        ip,
        userAgent,
        riskTier: 1,
        metadata: {
          reason: "mode_mismatch",
          keyMode,
          eventMode,
        },
      });

      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }
  }

  const result = await processStripeEvent(event);

  return NextResponse.json({
    received: true,
    handled: result.handled,
    reason: result.reason || null,
  });
}

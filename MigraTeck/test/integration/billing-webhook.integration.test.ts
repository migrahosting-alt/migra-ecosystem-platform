import { createHmac } from "node:crypto";
import { EntitlementStatus, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createBillingEntitlementBinding, createOrganization, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_integration_secret";

function stripeSignatureFor(body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const payload = `${timestamp}.${body}`;
  const signature = createHmac("sha256", webhookSecret).update(payload).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("Billing webhook integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("stripe subscription events sync entitlements and queue provisioning tasks", async () => {
    const org = await createOrganization({
      name: "Billing Org",
      slug: "billing-org",
    });

    await createBillingEntitlementBinding({
      externalPriceId: "price_migravoice_monthly",
      product: ProductKey.MIGRAVOICE,
      statusOnActive: EntitlementStatus.ACTIVE,
    });

    const client = new HttpClient(baseUrl);

    const activeEvent = {
      id: "evt_sub_active_1",
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: {
        object: {
          id: "sub_migrateck_1",
          customer: "cus_migrateck_1",
          status: "active",
          metadata: {
            orgId: org.id,
          },
          current_period_start: Math.floor(Date.now() / 1000) - 60,
          current_period_end: Math.floor(Date.now() / 1000) + 3600,
          items: {
            data: [
              {
                price: {
                  id: "price_migravoice_monthly",
                },
              },
            ],
          },
        },
      },
    };

    const activeBody = JSON.stringify(activeEvent);
    const activeResponse = await client.post<{ received?: boolean; handled?: boolean }>("/api/billing/stripe/webhook", {
      json: activeEvent,
      withOrigin: false,
      headers: {
        "stripe-signature": stripeSignatureFor(activeBody),
      },
    });

    expect(activeResponse.status).toBe(200);
    expect(activeResponse.body?.received).toBe(true);
    expect(activeResponse.body?.handled).toBe(true);

    const subscription = await prisma.billingSubscription.findUnique({
      where: {
        stripeSubscriptionId: "sub_migrateck_1",
      },
    });

    expect(subscription).toBeTruthy();
    expect(subscription?.status).toBe("ACTIVE");

    const entitlement = await prisma.orgEntitlement.findUnique({
      where: {
        orgId_product: {
          orgId: org.id,
          product: ProductKey.MIGRAVOICE,
        },
      },
    });

    expect(entitlement?.status).toBe(EntitlementStatus.ACTIVE);

    const queuedAfterActive = await prisma.provisioningTask.count({
      where: {
        orgId: org.id,
      },
    });

    expect(queuedAfterActive).toBeGreaterThanOrEqual(2);

    const duplicateResponse = await client.post<{ received?: boolean; handled?: boolean; reason?: string }>("/api/billing/stripe/webhook", {
      json: activeEvent,
      withOrigin: false,
      headers: {
        "stripe-signature": stripeSignatureFor(activeBody),
      },
    });

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body?.handled).toBe(true);
    expect(duplicateResponse.body?.reason).toBe("duplicate_event");

    const queuedAfterDuplicate = await prisma.provisioningTask.count({
      where: {
        orgId: org.id,
      },
    });

    expect(queuedAfterDuplicate).toBe(queuedAfterActive);

    const restrictedEvent = {
      ...activeEvent,
      id: "evt_sub_past_due_2",
      data: {
        object: {
          ...activeEvent.data.object,
          status: "past_due",
        },
      },
    };

    const restrictedBody = JSON.stringify(restrictedEvent);
    const restrictedResponse = await client.post<{ received?: boolean; handled?: boolean }>("/api/billing/stripe/webhook", {
      json: restrictedEvent,
      withOrigin: false,
      headers: {
        "stripe-signature": stripeSignatureFor(restrictedBody),
      },
    });

    expect(restrictedResponse.status).toBe(200);

    const restrictedEntitlement = await prisma.orgEntitlement.findUnique({
      where: {
        orgId_product: {
          orgId: org.id,
          product: ProductKey.MIGRAVOICE,
        },
      },
    });

    expect(restrictedEntitlement?.status).toBe(EntitlementStatus.RESTRICTED);

    const deprovisionTask = await prisma.provisioningTask.findFirst({
      where: {
        orgId: org.id,
        action: "POD_SCALE_DOWN",
      },
    });

    expect(deprovisionTask).toBeTruthy();

    const webhookEvents = await prisma.billingWebhookEvent.findMany({
      orderBy: { receivedAt: "asc" },
    });

    expect(webhookEvents).toHaveLength(2);
    expect(webhookEvents[0]?.eventId).toBe("evt_sub_active_1");
    expect(webhookEvents[0]?.status).toBe("PROCESSED");
    expect(webhookEvents[1]?.eventId).toBe("evt_sub_past_due_2");
    expect(webhookEvents[1]?.status).toBe("PROCESSED");
  });

  test("rejects live-mode payload when secret key mode is test", async () => {
    const client = new HttpClient(baseUrl);

    const event = {
      id: "evt_mode_mismatch_1",
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      livemode: true,
      data: {
        object: {
          id: "sub_mode_mismatch_1",
          status: "active",
          metadata: {
            orgId: "org_missing",
          },
        },
      },
    };

    const body = JSON.stringify(event);
    const response = await client.post<{ error?: string }>("/api/billing/stripe/webhook", {
      json: event,
      withOrigin: false,
      headers: {
        "stripe-signature": stripeSignatureFor(body),
      },
    });

    expect(response.status).toBe(400);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "BILLING_EVENT_REJECTED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
  });
});

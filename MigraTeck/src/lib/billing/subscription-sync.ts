import {
  BillingProvider,
  BillingSubscriptionStatus,
  BillingWebhookEventStatus,
  EntitlementStatus,
  ProductKey,
  ProvisioningJobSource,
  Prisma,
} from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import {
  applyDriveBillingState,
  mapSubscriptionStatusToDriveBillingState,
  resolveDrivePlanFromPriceIds,
} from "@/lib/drive/drive-billing-enforcement";
import { prisma } from "@/lib/prisma";
import { queueProvisioningForEntitlementTransition } from "@/lib/provisioning/queue";
import type { StripeEvent } from "@/lib/billing/stripe";

interface StripeSubscriptionObject {
  id: string;
  customer?: string | undefined;
  status?: string | undefined;
  metadata?: Record<string, string> | undefined;
  current_period_start?: number | undefined;
  current_period_end?: number | undefined;
  cancel_at_period_end?: boolean | undefined;
  canceled_at?: number | undefined;
  items?: {
    data?: Array<{
      price?: {
        id?: string | undefined;
      };
    }>;
  } | undefined;
}

function parseMetadataEventCreated(metadata: Prisma.JsonValue | null | undefined): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const raw = (metadata as Record<string, unknown>).eventCreated;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

async function recordWebhookReceipt(event: StripeEvent): Promise<boolean> {
  const created = await prisma.billingWebhookEvent.createMany({
    data: {
      provider: BillingProvider.STRIPE,
      eventId: event.id,
      eventType: event.type,
      eventCreated: event.created,
      livemode: event.livemode ?? null,
      status: BillingWebhookEventStatus.RECEIVED,
    },
    skipDuplicates: true,
  });

  return created.count === 1;
}

async function markWebhookEventStatus(
  eventId: string,
  status: BillingWebhookEventStatus,
  reason?: string | null | undefined,
): Promise<void> {
  await prisma.billingWebhookEvent.updateMany({
    where: { eventId },
    data: {
      status,
      reason: reason || null,
      processedAt: status === BillingWebhookEventStatus.RECEIVED ? null : new Date(),
    },
  });
}

function asSubscriptionObject(object: Record<string, unknown>): StripeSubscriptionObject | null {
  if (typeof object.id !== "string") {
    return null;
  }

  return object as unknown as StripeSubscriptionObject;
}

function mapStripeStatus(status: string | undefined): BillingSubscriptionStatus {
  const value = (status || "").toLowerCase();

  if (value === "trialing") return BillingSubscriptionStatus.TRIALING;
  if (value === "active") return BillingSubscriptionStatus.ACTIVE;
  if (value === "past_due") return BillingSubscriptionStatus.PAST_DUE;
  if (value === "canceled") return BillingSubscriptionStatus.CANCELED;
  if (value === "incomplete") return BillingSubscriptionStatus.INCOMPLETE;
  if (value === "incomplete_expired") return BillingSubscriptionStatus.INCOMPLETE_EXPIRED;
  if (value === "unpaid") return BillingSubscriptionStatus.UNPAID;
  if (value === "paused") return BillingSubscriptionStatus.PAUSED;

  return BillingSubscriptionStatus.PAST_DUE;
}

function toDate(input?: number): Date | null {
  if (!input || !Number.isFinite(input)) {
    return null;
  }

  return new Date(input * 1000);
}

function toEntitlementStatus(subscriptionStatus: BillingSubscriptionStatus, activeStatus: EntitlementStatus): EntitlementStatus {
  if (subscriptionStatus === BillingSubscriptionStatus.TRIALING) {
    return EntitlementStatus.TRIAL;
  }

  if (subscriptionStatus === BillingSubscriptionStatus.ACTIVE) {
    return activeStatus;
  }

  return EntitlementStatus.RESTRICTED;
}

async function resolveOrgId(subscription: StripeSubscriptionObject): Promise<string | null> {
  const orgIdFromMetadata = subscription.metadata?.orgId;
  if (orgIdFromMetadata) {
    return orgIdFromMetadata;
  }

  if (!subscription.customer) {
    return null;
  }

  const customer = await prisma.billingCustomer.findUnique({
    where: {
      stripeCustomerId: subscription.customer,
    },
    select: {
      orgId: true,
    },
  });

  return customer?.orgId || null;
}

function getPriceIds(subscription: StripeSubscriptionObject): string[] {
  const data = subscription.items?.data || [];

  return data
    .map((item) => item.price?.id)
    .filter((value): value is string => Boolean(value));
}

export async function syncStripeSubscriptionEvent(event: StripeEvent): Promise<{ handled: boolean; reason?: string }> {
  const object = asSubscriptionObject(event.data.object);

  if (!object) {
    return { handled: false, reason: "not_subscription_object" };
  }

  const orgId = await resolveOrgId(object);

  if (!orgId) {
    await writeAuditLog({
      action: "BILLING_EVENT_REJECTED",
      resourceType: "billing_event",
      resourceId: event.id,
      riskTier: 1,
      metadata: {
        reason: "org_unresolved",
        eventType: event.type,
        subscriptionId: object.id,
      },
    });

    return { handled: false, reason: "org_unresolved" };
  }

  const stripeStatus = mapStripeStatus(object.status);
  const periodStart = toDate(object.current_period_start);
  const periodEnd = toDate(object.current_period_end);
  const canceledAt = toDate(object.canceled_at);
  const priceIds = getPriceIds(object);

  const existingSubscription = await prisma.billingSubscription.findUnique({
    where: {
      stripeSubscriptionId: object.id,
    },
    select: {
      metadata: true,
    },
  });

  const latestKnownEventCreated = parseMetadataEventCreated(existingSubscription?.metadata);
  if (latestKnownEventCreated && event.created < latestKnownEventCreated) {
    await writeAuditLog({
      orgId,
      action: "BILLING_EVENT_IGNORED",
      resourceType: "billing_event",
      resourceId: event.id,
      riskTier: 0,
      metadata: {
        reason: "stale_event",
        subscriptionId: object.id,
        eventCreated: event.created,
        latestKnownEventCreated,
      },
    });

    return { handled: true, reason: "stale_event" };
  }

  const bindings = priceIds.length
    ? await prisma.billingEntitlementBinding.findMany({
        where: {
          provider: BillingProvider.STRIPE,
          externalPriceId: {
            in: priceIds,
          },
        },
      })
    : [];

  const bindingByPrice = new Map(bindings.map((binding) => [binding.externalPriceId, binding]));
  const uniqueProducts = new Map<ProductKey, (typeof bindings)[number]>();

  for (const priceId of priceIds) {
    const binding = bindingByPrice.get(priceId);
    if (!binding) {
      continue;
    }

    if (!uniqueProducts.has(binding.product)) {
      uniqueProducts.set(binding.product, binding);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (object.customer) {
      await tx.billingCustomer.upsert({
        where: {
          stripeCustomerId: object.customer,
        },
        create: {
          orgId,
          provider: BillingProvider.STRIPE,
          stripeCustomerId: object.customer,
          metadata: {
            source: "stripe:webhook",
          },
        },
        update: {
          orgId,
          metadata: {
            source: "stripe:webhook",
          },
        },
      });
    }

    await tx.billingSubscription.upsert({
      where: {
        stripeSubscriptionId: object.id,
      },
      create: {
        orgId,
        provider: BillingProvider.STRIPE,
        stripeSubscriptionId: object.id,
        stripeCustomerId: object.customer || null,
        status: stripeStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
        canceledAt,
        metadata: {
          eventId: event.id,
          eventType: event.type,
          eventCreated: event.created,
          prices: priceIds,
        } as Prisma.InputJsonValue,
      },
      update: {
        orgId,
        stripeCustomerId: object.customer || null,
        status: stripeStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
        canceledAt,
        metadata: {
          eventId: event.id,
          eventType: event.type,
          eventCreated: event.created,
          prices: priceIds,
        } as Prisma.InputJsonValue,
      },
    });
  });

  for (const [product, binding] of uniqueProducts.entries()) {
    const previous = await prisma.orgEntitlement.findUnique({
      where: {
        orgId_product: {
          orgId,
          product,
        },
      },
      select: {
        status: true,
      },
    });

    const nextStatus = toEntitlementStatus(stripeStatus, binding.statusOnActive);

    const entitlement = await prisma.orgEntitlement.upsert({
      where: {
        orgId_product: {
          orgId,
          product,
        },
      },
      create: {
        orgId,
        product,
        status: nextStatus,
        startsAt: periodStart,
        endsAt: nextStatus === EntitlementStatus.RESTRICTED ? periodEnd : null,
        notes: `Synced from Stripe subscription ${object.id}`,
      },
      update: {
        status: nextStatus,
        startsAt: periodStart,
        endsAt: nextStatus === EntitlementStatus.RESTRICTED ? periodEnd : null,
        notes: `Synced from Stripe subscription ${object.id}`,
      },
    });

    if (previous?.status !== nextStatus) {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { slug: true },
      });

      await queueProvisioningForEntitlementTransition({
        orgId,
        orgSlug: org?.slug || "",
        product,
        previousStatus: previous?.status || null,
        newStatus: nextStatus,
        source: ProvisioningJobSource.STRIPE,
        transitionId: `${event.id}:${product}`,
      });
    }

    if (product === ProductKey.MIGRADRIVE) {
      const resolvedPlan = resolveDrivePlanFromPriceIds(priceIds);
      const driveBillingState = mapSubscriptionStatusToDriveBillingState(stripeStatus);
      const enforcement = await applyDriveBillingState({
        orgId,
        billingState: driveBillingState,
        planCode: resolvedPlan?.planCode,
        storageQuotaGb: resolvedPlan?.storageQuotaGb,
        subscriptionId: object.id,
        entitlementId: entitlement.id,
        traceId: event.id,
        idempotencyKey: `${event.id}:${product}:billing-enforcer`,
      });

      await writeAuditLog({
        orgId,
        action: enforcement.ok ? "DRIVE_BILLING_ENFORCEMENT_APPLIED" : "DRIVE_BILLING_ENFORCEMENT_SKIPPED",
        resourceType: "drive_tenant",
        resourceId: enforcement.ok ? enforcement.tenant.id : orgId,
        riskTier: 1,
        metadata: {
          eventId: event.id,
          subscriptionId: object.id,
          billingState: driveBillingState,
          planCode: resolvedPlan?.planCode || null,
          storageQuotaGb: resolvedPlan?.storageQuotaGb || null,
          result: enforcement.ok ? enforcement.action : enforcement.error,
        },
      });
    }

    await writeAuditLog({
      orgId,
      action: "BILLING_ENTITLEMENT_APPLIED",
      resourceType: "org_entitlement",
      resourceId: product,
      riskTier: 1,
      metadata: {
        eventId: event.id,
        subscriptionId: object.id,
        stripeStatus,
        previousStatus: previous?.status || null,
        nextStatus,
      },
    });
  }

  await writeAuditLog({
    orgId,
    action: "BILLING_SUBSCRIPTION_SYNCED",
    resourceType: "billing_subscription",
    resourceId: object.id,
    riskTier: 1,
    metadata: {
      eventId: event.id,
      eventType: event.type,
      stripeStatus,
      prices: priceIds,
      mappedProducts: Array.from(uniqueProducts.keys()),
    },
  });

  return { handled: true };
}

export async function processStripeEvent(event: StripeEvent): Promise<{ handled: boolean; reason?: string }> {
  const isNewEvent = await recordWebhookReceipt(event);
  if (!isNewEvent) {
    await writeAuditLog({
      action: "BILLING_EVENT_IGNORED",
      resourceType: "billing_event",
      resourceId: event.id,
      riskTier: 0,
      metadata: {
        eventType: event.type,
        reason: "duplicate_event",
      },
    });

    return { handled: true, reason: "duplicate_event" };
  }

  try {
    let result: { handled: boolean; reason?: string };
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      result = await syncStripeSubscriptionEvent(event);
    } else if (event.type === "checkout.session.completed") {
      // Checkout completion is handled implicitly via the subscription.created
      // event that Stripe fires immediately after. Log it for audit trail.
      await writeAuditLog({
        action: "BILLING_CHECKOUT_COMPLETED",
        resourceType: "billing_event",
        resourceId: event.id,
        riskTier: 1,
        metadata: {
          eventType: event.type,
          sessionId: String((event.data.object as Record<string, unknown>).id || ""),
          subscriptionId: String((event.data.object as Record<string, unknown>).subscription || ""),
          customerId: String((event.data.object as Record<string, unknown>).customer || ""),
        },
      });
      result = { handled: true };
    } else {
      await writeAuditLog({
        action: "BILLING_EVENT_IGNORED",
        resourceType: "billing_event",
        resourceId: event.id,
        riskTier: 0,
        metadata: {
          eventType: event.type,
        },
      });

      result = { handled: true, reason: "event_ignored" };
    }

    const shouldMarkIgnored = !result.handled || result.reason === "event_ignored" || result.reason === "org_unresolved" || result.reason === "stale_event";
    await markWebhookEventStatus(
      event.id,
      shouldMarkIgnored ? BillingWebhookEventStatus.IGNORED : BillingWebhookEventStatus.PROCESSED,
      result.reason || null,
    );

    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "billing_processing_error";
    await markWebhookEventStatus(event.id, BillingWebhookEventStatus.FAILED, reason);
    throw error;
  }
}

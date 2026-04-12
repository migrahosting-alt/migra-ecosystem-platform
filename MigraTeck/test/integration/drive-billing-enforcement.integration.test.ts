import { DriveTenantStatus, EntitlementStatus, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import {
  createBillingEntitlementBinding,
  getMigraDrivePlanFixture,
  createOrganization,
  resetDatabase,
} from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";
import { syncStripeSubscriptionEvent } from "../../src/lib/billing/subscription-sync";

const starterDrivePlan = getMigraDrivePlanFixture();
const businessDrivePlan = getMigraDrivePlanFixture("business");

function makeStripeSubscriptionEvent(input: {
  eventId: string;
  orgId: string;
  subscriptionId: string;
  status: string;
  priceId: string;
}) {
  const now = Math.floor(Date.now() / 1000);

  return {
    id: input.eventId,
    type: "customer.subscription.updated",
    created: now,
    livemode: false,
    data: {
      object: {
        id: input.subscriptionId,
        customer: `cus_${input.subscriptionId}`,
        status: input.status,
        metadata: {
          orgId: input.orgId,
        },
        current_period_start: now - 60,
        current_period_end: now + 3600,
        items: {
          data: [
            {
              price: {
                id: input.priceId,
              },
            },
          ],
        },
      },
    },
  };
}

describe("MigraDrive billing enforcement integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("billing sync updates MigraDrive plan and restricts on past due", async () => {
    const org = await createOrganization({
      name: "Drive Billing Org",
      slug: "drive-billing-org",
    });

    await createBillingEntitlementBinding({
      externalPriceId: "price_1TKsXYIrfeNRpsizU8JyfNZQ",
      product: ProductKey.MIGRADRIVE,
      statusOnActive: EntitlementStatus.ACTIVE,
    });

    const initialTenant = await prisma.driveTenant.create({
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        status: DriveTenantStatus.ACTIVE,
        ...starterDrivePlan,
      },
    });

    const activeResult = await syncStripeSubscriptionEvent(
      makeStripeSubscriptionEvent({
        eventId: "evt_drive_active_001",
        orgId: org.id,
        subscriptionId: "sub_drive_001",
        status: "active",
        priceId: "price_1TKsXYIrfeNRpsizU8JyfNZQ",
      }),
    );

    expect(activeResult.handled).toBe(true);

    const upgradedTenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: initialTenant.id } });
    expect(upgradedTenant.planCode).toBe(businessDrivePlan.planCode);
    expect(upgradedTenant.storageQuotaGb).toBe(businessDrivePlan.storageQuotaGb);
    expect(upgradedTenant.subscriptionId).toBe("sub_drive_001");
    expect(upgradedTenant.status).toBe(DriveTenantStatus.ACTIVE);

    const pastDueResult = await syncStripeSubscriptionEvent(
      makeStripeSubscriptionEvent({
        eventId: "evt_drive_past_due_002",
        orgId: org.id,
        subscriptionId: "sub_drive_001",
        status: "past_due",
        priceId: "price_1TKsXYIrfeNRpsizU8JyfNZQ",
      }),
    );

    expect(pastDueResult.handled).toBe(true);

    const restrictedTenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: initialTenant.id } });
    expect(restrictedTenant.status).toBe(DriveTenantStatus.RESTRICTED);
    expect(restrictedTenant.restrictionReason).toBe("billing_past_due");

    const restrictedEvent = await prisma.driveTenantEvent.findFirst({
      where: {
        tenantId: initialTenant.id,
        action: "TENANT_RESTRICTED",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(restrictedEvent).toBeTruthy();
  });

  test("billing restoration keeps tenant restricted when downgraded over quota", async () => {
    const org = await createOrganization({
      name: "Drive Quota Org",
      slug: "drive-quota-org",
    });

    await createBillingEntitlementBinding({
      externalPriceId: "price_1TKsXXIrfeNRpsizMarzVWpx",
      product: ProductKey.MIGRADRIVE,
      statusOnActive: EntitlementStatus.ACTIVE,
    });

    await prisma.driveTenant.create({
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        status: DriveTenantStatus.RESTRICTED,
        ...businessDrivePlan,
        storageUsedBytes: BigInt(150 * 1024 * 1024 * 1024),
        restrictionReason: "billing_past_due",
      },
    });

    const result = await syncStripeSubscriptionEvent(
      makeStripeSubscriptionEvent({
        eventId: "evt_drive_restore_003",
        orgId: org.id,
        subscriptionId: "sub_drive_003",
        status: "active",
        priceId: "price_1TKsXXIrfeNRpsizMarzVWpx",
      }),
    );

    expect(result.handled).toBe(true);

    const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { orgId: org.id } });
    expect(tenant.planCode).toBe(starterDrivePlan.planCode);
    expect(tenant.storageQuotaGb).toBe(starterDrivePlan.storageQuotaGb);
    expect(tenant.status).toBe(DriveTenantStatus.RESTRICTED);
    expect(tenant.restrictionReason).toBe("quota_exceeded_after_downgrade");
  });

  test("billing cancellation disables the existing tenant", async () => {
    const org = await createOrganization({
      name: "Drive Cancel Org",
      slug: "drive-cancel-org",
    });

    await createBillingEntitlementBinding({
      externalPriceId: "price_1TKsXXIrfeNRpsizMarzVWpx",
      product: ProductKey.MIGRADRIVE,
      statusOnActive: EntitlementStatus.ACTIVE,
    });

    const tenant = await prisma.driveTenant.create({
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        status: DriveTenantStatus.ACTIVE,
        ...starterDrivePlan,
      },
    });

    const result = await syncStripeSubscriptionEvent(
      makeStripeSubscriptionEvent({
        eventId: "evt_drive_cancel_004",
        orgId: org.id,
        subscriptionId: "sub_drive_004",
        status: "canceled",
        priceId: "price_1TKsXXIrfeNRpsizMarzVWpx",
      }),
    );

    expect(result.handled).toBe(true);

    const disabledTenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(disabledTenant.status).toBe(DriveTenantStatus.DISABLED);
    expect(disabledTenant.disableReason).toBe("billing_canceled");
    expect(disabledTenant.disabledAt).toBeTruthy();
  });
});
import { EntitlementStatus, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createEntitlement, createOrganization, createPlatformConfig, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";
import { transitionExpiredEntitlements } from "../../workers/entitlement-expiry";

describe("Entitlement expiry worker integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("expired trial transitions to restricted when worker is enabled", async () => {
    const org = await createOrganization({
      name: "Expiry Org",
      slug: "expiry-org",
    });

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRAPILOT,
      status: EntitlementStatus.TRIAL,
      endsAt: new Date(Date.now() - 60_000),
    });

    const changed = await transitionExpiredEntitlements(new Date());
    expect(changed).toBe(1);

    const updated = await prisma.orgEntitlement.findUnique({
      where: {
        orgId_product: {
          orgId: org.id,
          product: ProductKey.MIGRAPILOT,
        },
      },
      select: {
        status: true,
      },
    });

    expect(updated?.status).toBe(EntitlementStatus.RESTRICTED);
  });

  test("pause flag prevents expiry transitions", async () => {
    const org = await createOrganization({
      name: "Paused Expiry Org",
      slug: "paused-expiry-org",
    });

    await createPlatformConfig({
      pauseEntitlementExpiryWorker: true,
    });

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRAPANEL,
      status: EntitlementStatus.TRIAL,
      endsAt: new Date(Date.now() - 60_000),
    });

    const changed = await transitionExpiredEntitlements(new Date());
    expect(changed).toBe(0);

    const unchanged = await prisma.orgEntitlement.findUnique({
      where: {
        orgId_product: {
          orgId: org.id,
          product: ProductKey.MIGRAPANEL,
        },
      },
      select: {
        status: true,
      },
    });

    expect(unchanged?.status).toBe(EntitlementStatus.TRIAL);
  });
});

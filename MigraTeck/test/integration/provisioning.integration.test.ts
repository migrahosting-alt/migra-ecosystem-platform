import { EntitlementStatus, OrgRole, ProductKey, ProvisioningJobSource } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createEntitlement, createMembership, createOrganization, createPlatformConfig, createUser, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";
import { queueProvisioningForEntitlementTransition } from "../../src/lib/provisioning/queue";
import { processProvisioningQueue } from "../../workers/provisioning-engine";

describe("Provisioning queue integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("entitlement transitions queue provisioning tasks", async () => {
    const admin = await createUser({
      email: "prov-admin@example.com",
      password: "ProvAdminPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Provisioning Org",
      slug: "provisioning-org",
      isMigraHostingClient: true,
      createdById: admin.id,
    });

    await createMembership({ userId: admin.id, orgId: org.id, role: OrgRole.ADMIN });
    await prisma.user.update({ where: { id: admin.id }, data: { defaultOrgId: org.id } });

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRAPANEL,
      status: EntitlementStatus.RESTRICTED,
    });

    await queueProvisioningForEntitlementTransition({
      orgId: org.id,
      orgSlug: org.slug,
      product: ProductKey.MIGRAPANEL,
      previousStatus: EntitlementStatus.RESTRICTED,
      newStatus: EntitlementStatus.ACTIVE,
      source: ProvisioningJobSource.MANUAL,
      createdByUserId: admin.id,
      actorRole: OrgRole.ADMIN,
      transitionId: "test:panel:activate",
    });

    const podCreateTask = await prisma.provisioningTask.findFirst({
      where: {
        orgId: org.id,
        product: ProductKey.MIGRAPANEL,
        action: "POD_CREATE",
      },
    });

    expect(podCreateTask).toBeTruthy();

    await queueProvisioningForEntitlementTransition({
      orgId: org.id,
      orgSlug: org.slug,
      product: ProductKey.MIGRAPANEL,
      previousStatus: EntitlementStatus.ACTIVE,
      newStatus: EntitlementStatus.RESTRICTED,
      source: ProvisioningJobSource.MANUAL,
      createdByUserId: admin.id,
      actorRole: OrgRole.ADMIN,
      transitionId: "test:panel:restrict",
    });

    const scaleDownTask = await prisma.provisioningTask.findFirst({
      where: {
        orgId: org.id,
        product: ProductKey.MIGRAPANEL,
        action: "POD_SCALE_DOWN",
      },
    });

    expect(scaleDownTask).toBeTruthy();
  });



  test("MIGRAHOSTING activation queues pod and dns only", async () => {
    const admin = await createUser({
      email: "hosting-admin@example.com",
      password: "HostingAdminPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Hosting Queue Org",
      slug: "hosting-queue-org",
      isMigraHostingClient: true,
      createdById: admin.id,
    });

    await createMembership({ userId: admin.id, orgId: org.id, role: OrgRole.ADMIN });
    await prisma.user.update({ where: { id: admin.id }, data: { defaultOrgId: org.id } });

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRAHOSTING,
      status: EntitlementStatus.RESTRICTED,
    });

    await queueProvisioningForEntitlementTransition({
      orgId: org.id,
      orgSlug: org.slug,
      product: ProductKey.MIGRAHOSTING,
      previousStatus: EntitlementStatus.RESTRICTED,
      newStatus: EntitlementStatus.ACTIVE,
      source: ProvisioningJobSource.MANUAL,
      createdByUserId: admin.id,
      actorRole: OrgRole.ADMIN,
      transitionId: "test:hosting:activate",
    });

    const actions = await prisma.provisioningTask.findMany({
      where: { orgId: org.id, product: ProductKey.MIGRAHOSTING },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });

    expect(actions.map((item) => item.action)).toEqual(["POD_CREATE", "DNS_PROVISION"]);
  });

  test("provisioning worker respects pause flag", async () => {
    const org = await createOrganization({
      name: "Paused Provisioning Org",
      slug: "paused-provisioning-org",
    });

    await createPlatformConfig({
      pauseProvisioningWorker: true,
    });

    const queued = await prisma.provisioningTask.create({
      data: {
        orgId: org.id,
        action: "POD_CREATE",
      },
    });

    const processedCount = await processProvisioningQueue();
    expect(processedCount).toBe(0);

    const current = await prisma.provisioningTask.findUnique({ where: { id: queued.id } });
    expect(current?.status).toBe("PENDING");
    expect(current?.attempts).toBe(0);
  });
});

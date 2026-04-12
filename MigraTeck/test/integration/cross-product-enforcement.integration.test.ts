import { DriveTenantStatus, EntitlementStatus, OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, getMigraDrivePlanFixture, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

async function createScopedClient(input: { slug: string; isMigraHostingClient?: boolean | undefined }) {
  const user = await createUser({
    email: `${input.slug}@example.com`,
    password: "ProofPass123!",
    emailVerified: true,
  });
  const org = await createOrganization({
    name: `${input.slug} org`,
    slug: input.slug,
    isMigraHostingClient: input.isMigraHostingClient,
    createdById: user.id,
  });
  await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
  await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

  const client = new HttpClient(baseUrl);
  await createSessionForUser(client, user.id);

  return { client, user, org };
}

describe("Cross-product runtime enforcement", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("client-only products stay gated for non-clients without entitlement", async () => {
    const { client, org } = await createScopedClient({ slug: "external-org", isMigraHostingClient: false });

    await prisma.orgEntitlement.create({
      data: {
        orgId: org.id,
        product: ProductKey.MIGRAHOSTING,
        status: EntitlementStatus.ACTIVE,
      },
    });

    const response = await client.get<{ products?: Array<{ key: ProductKey; canLaunch: boolean; requestAccess: boolean; reason: string | null }> }>("/api/products");
    expect(response.status).toBe(200);

    const hosting = response.body?.products?.find((product) => product.key === ProductKey.MIGRAHOSTING);
    expect(hosting?.canLaunch).toBe(false);
    expect(hosting?.requestAccess).toBe(true);
    expect(hosting?.reason).toBe("CLIENT_ONLY_PRODUCT");
  });

  test("client and internal org rules apply across hosting, panel, and drive", async () => {
    const { client, org } = await createScopedClient({ slug: "migra-internal-proof", isMigraHostingClient: true });
    const drivePlan = getMigraDrivePlanFixture("business");

    await prisma.orgEntitlement.createMany({
      data: [
        {
          orgId: org.id,
          product: ProductKey.MIGRAHOSTING,
          status: EntitlementStatus.ACTIVE,
        },
        {
          orgId: org.id,
          product: ProductKey.MIGRAPANEL,
          status: EntitlementStatus.INTERNAL_ONLY,
        },
        {
          orgId: org.id,
          product: ProductKey.MIGRADRIVE,
          status: EntitlementStatus.ACTIVE,
        },
      ],
    });

    await prisma.driveTenant.create({
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        status: DriveTenantStatus.RESTRICTED,
        restrictionReason: "quota_exceeded_after_downgrade",
        ...drivePlan,
      },
    });

    const response = await client.get<{ products?: Array<{ key: ProductKey; canLaunch: boolean; tenantStatus?: string | null; tenantLifecycleReason?: string | null }> }>("/api/products");
    expect(response.status).toBe(200);

    const hosting = response.body?.products?.find((product) => product.key === ProductKey.MIGRAHOSTING);
    const panel = response.body?.products?.find((product) => product.key === ProductKey.MIGRAPANEL);
    const drive = response.body?.products?.find((product) => product.key === ProductKey.MIGRADRIVE);

    expect(hosting?.canLaunch).toBe(true);
    expect(panel?.canLaunch).toBe(true);
    expect(drive?.canLaunch).toBe(true);
    expect(drive?.tenantStatus).toBe("RESTRICTED");
    expect(drive?.tenantLifecycleReason).toBe("quota_exceeded_after_downgrade");
  });
});
import { EntitlementStatus, OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createEntitlement, createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Request access integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("non-entitled org can request product access and CSRF rejects wrong origin", async () => {
    const user = await createUser({
      email: "access-request-user@example.com",
      password: "AccessReqPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Access Request Org",
      slug: "access-request-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.MEMBER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const created = await client.post<{ request?: { id: string; product: ProductKey } }>("/api/products/request-access", {
      json: {
        orgId: org.id,
        product: ProductKey.MIGRAVOICE,
        message: "Please enable for pilot rollout.",
      },
    });

    expect(created.status).toBe(201);
    expect(created.body?.request?.product).toBe(ProductKey.MIGRAVOICE);

    const row = await prisma.accessRequest.findFirst({
      where: {
        orgId: org.id,
        createdByUserId: user.id,
        product: ProductKey.MIGRAVOICE,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(row).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({
      where: {
        orgId: org.id,
        userId: user.id,
        action: "PRODUCT_ACCESS_REQUESTED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();

    const csrfDenied = await client.post<{ error?: string }>("/api/products/request-access", {
      json: {
        orgId: org.id,
        product: ProductKey.MIGRAPILOT,
      },
      withOrigin: false,
    });

    expect(csrfDenied.status).toBe(403);
    expect(csrfDenied.body?.error).toBe("CSRF validation failed.");

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRAPILOT,
      status: EntitlementStatus.INTERNAL_ONLY,
    });

    const internalOnlyDenied = await client.post<{ error?: string }>("/api/products/request-access", {
      json: {
        orgId: org.id,
        product: ProductKey.MIGRAPILOT,
      },
    });

    expect(internalOnlyDenied.status).toBe(403);
  });
});

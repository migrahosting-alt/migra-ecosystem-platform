import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("CSRF integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("mutating route fails without Origin and succeeds with same-origin header", async () => {
    const user = await createUser({
      email: "csrf-user@example.com",
      password: "CsrfPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "CSRF Org",
      slug: "csrf-org",
      createdById: user.id,
    });

    await createMembership({
      userId: user.id,
      orgId: org.id,
      role: OrgRole.OWNER,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { defaultOrgId: org.id },
    });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const missingOrigin = await client.post<{ error?: string }>("/api/orgs/switch", {
      json: {
        orgId: org.id,
      },
      withOrigin: false,
    });

    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body?.error).toBe("CSRF validation failed.");

    const withOrigin = await client.post<{ message?: string }>("/api/orgs/switch", {
      json: {
        orgId: org.id,
      },
      withOrigin: true,
    });

    expect(withOrigin.status).toBe(200);
    expect(withOrigin.body?.message).toMatch(/Organization switched/i);
  });
});

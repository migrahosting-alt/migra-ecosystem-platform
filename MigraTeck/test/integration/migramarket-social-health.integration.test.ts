import { OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createEntitlement, createMembership, createOrganization, createPlatformConfig, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("MigraMarket social health integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    await createPlatformConfig({ allowOrgCreate: true, allowPublicSignup: true });
  });

  test("workspace exposes actionable health for expiring and reconnect-required social accounts", async () => {
    const user = await createUser({
      email: "social-health-owner@example.com",
      password: "SocialHealthPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Social Health Org",
      slug: "social-health-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    await prisma.migraMarketSocialConnection.createMany({
      data: [
        {
          orgId: org.id,
          platform: "facebook",
          handle: "MigraTeck",
          accessModel: "oauth",
          publishMode: "api",
          status: "ready",
          externalAccountId: "fb-page-1",
          credentialCiphertext: "ciphertext",
          tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          lastVerifiedAt: new Date(),
        },
        {
          orgId: org.id,
          platform: "linkedin",
          handle: "MigraTeck LLC",
          accessModel: "oauth",
          publishMode: "api",
          status: "reconnect_required",
          externalAccountId: "li-person-1",
          credentialCiphertext: "ciphertext",
          tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
          lastVerifiedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          metadata: {
            lastSyncError: "invalid_grant",
          },
        },
        {
          orgId: org.id,
          platform: "x",
          handle: "@MigraTeckHQ",
          accessModel: "oauth",
          publishMode: "api",
          status: "ready",
          externalAccountId: null,
          credentialCiphertext: null,
          lastVerifiedAt: null,
          metadata: {
            migrationState: "reconnect_required",
            migrationNote: "Imported placeholder token",
          },
        },
      ],
    });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const response = await client.get<{
      workspace?: {
        socialConnections: Array<{
          platform: string;
          health: { state: string; recommendedAction: string; needsAttention: boolean };
          publishReadiness: { state: string; label: string; canDirectPublish: boolean; needsAttention: boolean };
        }>;
      };
    }>("/api/migramarket/workspace");

    expect(response.status).toBe(200);
    const facebook = response.body?.workspace?.socialConnections.find((item) => item.platform === "facebook");
    const linkedin = response.body?.workspace?.socialConnections.find((item) => item.platform === "linkedin");
    const x = response.body?.workspace?.socialConnections.find((item) => item.platform === "x");

    expect(facebook?.health.state).toBe("token_expiring");
    expect(facebook?.health.recommendedAction).toBe("refresh");
    expect(facebook?.health.needsAttention).toBe(true);
    expect(facebook?.publishReadiness.needsAttention).toBe(true);
    expect(facebook?.publishReadiness.canDirectPublish).toBe(false);

    expect(linkedin?.health.state).toBe("reconnect_required");
    expect(linkedin?.health.recommendedAction).toBe("reconnect");
    expect(linkedin?.health.needsAttention).toBe(true);
    expect(linkedin?.publishReadiness.needsAttention).toBe(true);
    expect(linkedin?.publishReadiness.canDirectPublish).toBe(false);

    expect(x?.health.state).toBe("disconnected");
    expect(x?.health.recommendedAction).toBe("connect");
    expect(x?.publishReadiness.state).toBe("connect_required");
    expect(x?.publishReadiness.label).toBe("Connect OAuth");
    expect(x?.publishReadiness.canDirectPublish).toBe(false);
    expect(x?.publishReadiness.needsAttention).toBe(true);
  });
});

import { createHmac } from "node:crypto";
import { ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createEntitlement, createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

function decodeLaunchToken(token: string): Record<string, unknown> {
  const [encoded] = token.split(".");
  if (!encoded) {
    throw new Error("Missing launch token payload");
  }

  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
}

function signCustomToken(payload: Record<string, unknown>, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describe("Product launch integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("launch enforces entitlements and consume enforces aud/exp/nonce", async () => {
    const user = await createUser({
      email: "launch-user@example.com",
      password: "LaunchPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Launch Org",
      slug: "launch-org",
      isMigraHostingClient: true,
      createdById: user.id,
    });

    await createMembership({
      userId: user.id,
      orgId: org.id,
      role: "MEMBER",
    });

    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const denied = await client.post<{ error?: string }>("/api/products/launch", {
      json: {
        product: ProductKey.MIGRAPANEL,
      },
    });

    expect(denied.status).toBe(403);
    expect(denied.body?.error).toMatch(/Product access is not active/i);

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRAPANEL,
    });

    const launched = await client.post<{ launchUrl?: string }>("/api/products/launch", {
      json: {
        product: ProductKey.MIGRAPANEL,
      },
    });

    expect(launched.status).toBe(200);
    expect(launched.body?.launchUrl).toBeTruthy();

    const launchUrl = new URL(launched.body?.launchUrl || "");
    const token = launchUrl.searchParams.get("token");
    expect(token).toBeTruthy();

    const payload = decodeLaunchToken(token || "");
    expect(payload.aud).toBe(launchUrl.host);
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect(typeof payload.nonce).toBe("string");

    const wrongAudience = await client.post<{ error?: string }>("/api/products/consume", {
      json: {
        token,
        expectedAudience: "wrong.integration.migrateck.com",
      },
      withOrigin: false,
    });

    expect(wrongAudience.status).toBe(401);

    const consumed = await client.post<{ bootstrap?: { product?: string } }>("/api/products/consume", {
      json: {
        token,
        expectedAudience: launchUrl.host,
      },
      withOrigin: false,
    });

    expect(consumed.status).toBe(200);
    expect(consumed.body?.bootstrap?.product).toBe(ProductKey.MIGRAPANEL);

    const replayed = await client.post<{ error?: string }>("/api/products/consume", {
      json: {
        token,
        expectedAudience: launchUrl.host,
      },
      withOrigin: false,
    });

    expect(replayed.status).toBe(401);

    const now = Math.floor(Date.now() / 1000);
    const expiredToken = signCustomToken(
      {
        sub: user.id,
        orgId: org.id,
        product: ProductKey.MIGRAPANEL,
        aud: launchUrl.host,
        nonce: "expired-nonce",
        iat: now - 120,
        exp: now - 60,
      },
      process.env.LAUNCH_TOKEN_SECRET || "integration-tests-launch-secret-32-plus",
    );

    const expired = await client.post<{ error?: string }>("/api/products/consume", {
      json: {
        token: expiredToken,
        expectedAudience: launchUrl.host,
      },
      withOrigin: false,
    });

    expect(expired.status).toBe(401);
  });

});

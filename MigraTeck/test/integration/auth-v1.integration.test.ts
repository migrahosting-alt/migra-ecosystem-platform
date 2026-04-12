import { OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import {
  createMembership,
  createOrganization,
  createPlatformConfig,
  createUser,
  createVerificationToken,
  resetDatabase,
} from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Auth v1 integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("signup uses normalized envelope and provisions default organization", async () => {
    await createPlatformConfig({
      allowPublicSignup: true,
      allowOrgCreate: true,
      waitlistMode: false,
    });

    const client = new HttpClient(baseUrl);
    const signup = await client.post<{
      ok?: boolean;
      data?: {
        created?: boolean;
        verificationRequired?: boolean;
        user?: { email?: string; status?: string } | null;
        organization?: { slug?: string } | null;
      };
    }>("/api/v1/auth/signup", {
      json: {
        displayName: "Slice One Owner",
        email: "slice-one@example.com",
        password: "VeryStrongPassword123!",
        organizationName: "Slice One Org",
      },
    });

    expect(signup.status).toBe(201);
    expect(signup.body?.ok).toBe(true);
    expect(signup.body?.data?.created).toBe(true);
    expect(signup.body?.data?.verificationRequired).toBe(true);
    expect(signup.body?.data?.user?.email).toBe("slice-one@example.com");
    expect(signup.body?.data?.user?.status).toBe("PENDING_VERIFICATION");
    expect(signup.body?.data?.organization?.slug).toBe("slice-one-org");

    const createdUser = await prisma.user.findUnique({
      where: { email: "slice-one@example.com" },
      include: {
        memberships: {
          include: { org: true },
        },
      },
    });

    expect(createdUser?.defaultOrgId).toBeTruthy();
    expect(createdUser?.memberships).toHaveLength(1);
    expect(createdUser?.memberships[0]?.role).toBe(OrgRole.OWNER);

    const defaultOrgId = createdUser?.defaultOrgId;
    expect(defaultOrgId).toBeTruthy();

    if (!defaultOrgId) {
      throw new Error("Expected signup to assign a default organization.");
    }

    const driveEntitlement = await prisma.orgEntitlement.findFirst({
      where: {
        orgId: defaultOrgId,
        product: ProductKey.MIGRADRIVE,
      },
    });
    expect(driveEntitlement).toBeTruthy();
  });

  test("verify, login, me, organizations, switch, refresh, and logout work on v1 surface", async () => {
    const user = await createUser({
      email: "v1-auth@example.com",
      password: "VerifiedPass123!",
      emailVerified: false,
      name: "V1 Owner",
    });

    const orgOne = await createOrganization({
      name: "Primary Org",
      slug: "primary-org",
      createdById: user.id,
    });
    const orgTwo = await createOrganization({
      name: "Secondary Org",
      slug: "secondary-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: orgOne.id, role: OrgRole.OWNER });
    await createMembership({ userId: user.id, orgId: orgTwo.id, role: OrgRole.ADMIN });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: orgOne.id } });

    const verificationToken = "known-v1-verification-token-1234567890";
    await createVerificationToken({ userId: user.id, token: verificationToken });

    const client = new HttpClient(baseUrl);

    const verify = await client.post<{
      ok?: boolean;
      data?: { emailVerifiedAt?: string; message?: string };
    }>("/api/v1/auth/verify-email", {
      json: { token: verificationToken },
    });
    expect(verify.status).toBe(200);
    expect(verify.body?.ok).toBe(true);
    expect(verify.body?.data?.emailVerifiedAt).toBeTruthy();

    const login = await client.post<{
      ok?: boolean;
      data?: {
        accessToken?: string;
        activeOrganization?: { id?: string; slug?: string } | null;
        activeRole?: string | null;
        memberships?: Array<{ organization: { slug?: string }; isCurrent: boolean }>;
      };
    }>("/api/v1/auth/login", {
      json: {
        email: "v1-auth@example.com",
        password: "VerifiedPass123!",
      },
    });

    expect(login.status).toBe(200);
    expect(login.body?.ok).toBe(true);
    expect(login.body?.data?.accessToken).toBeTruthy();
    expect(login.body?.data?.activeOrganization?.slug).toBe("primary-org");
    expect(login.body?.data?.activeRole).toBe("OWNER");
    expect(client.hasCookieContaining("session-token")).toBe(true);
    expect(client.hasCookie("migradrive_refresh")).toBe(true);

    const meBySession = await client.get<{
      ok?: boolean;
      data?: { activeOrganization?: { slug?: string } | null; memberships?: unknown[] };
    }>("/api/v1/me", { withOrigin: false });
    expect(meBySession.status).toBe(200);
    expect(meBySession.body?.ok).toBe(true);
    expect(meBySession.body?.data?.activeOrganization?.slug).toBe("primary-org");
    expect(meBySession.body?.data?.memberships).toHaveLength(2);

    const meByBearer = await client.get<{
      ok?: boolean;
      data?: { activeOrganization?: { slug?: string } | null };
    }>("/api/v1/me", {
      headers: {
        authorization: `Bearer ${login.body?.data?.accessToken}`,
      },
      withOrigin: false,
    });
    expect(meByBearer.status).toBe(200);
    expect(meByBearer.body?.data?.activeOrganization?.slug).toBe("primary-org");

    const organizations = await client.get<{
      ok?: boolean;
      data?: { organizations?: Array<{ organization: { slug?: string }; isCurrent: boolean }> };
    }>("/api/v1/me/organizations", { withOrigin: false });
    expect(organizations.status).toBe(200);
    expect(organizations.body?.ok).toBe(true);
    expect(organizations.body?.data?.organizations).toHaveLength(2);
    expect(organizations.body?.data?.organizations?.find((entry) => entry.organization.slug === "primary-org")?.isCurrent).toBe(true);

    const switched = await client.post<{
      ok?: boolean;
      data?: { activeOrganization?: { id?: string; slug?: string } | null; activeRole?: string | null };
    }>("/api/v1/me/switch-organization", {
      json: { orgId: orgTwo.id },
    });
    expect(switched.status).toBe(200);
    expect(switched.body?.ok).toBe(true);
    expect(switched.body?.data?.activeOrganization?.slug).toBe("secondary-org");
    expect(switched.body?.data?.activeRole).toBe("ADMIN");

    const refreshed = await client.post<{
      ok?: boolean;
      data?: { accessToken?: string; activeOrganization?: { slug?: string } | null };
    }>("/api/v1/auth/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body?.ok).toBe(true);
    expect(refreshed.body?.data?.accessToken).toBeTruthy();
    expect(refreshed.body?.data?.activeOrganization?.slug).toBe("primary-org");

    const logout = await client.post<{ ok?: boolean; data?: { message?: string } }>("/api/v1/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.body?.ok).toBe(true);
    expect(logout.body?.data?.message).toMatch(/logged out/i);

    const afterLogout = await client.get("/api/v1/me", { withOrigin: false });
    expect(afterLogout.status).toBe(401);

    const refreshAfterLogout = await client.post<{ ok?: boolean; error?: { code?: string } }>("/api/v1/auth/refresh");
    expect(refreshAfterLogout.status).toBe(401);
    expect(refreshAfterLogout.body?.ok).toBe(false);
    expect(refreshAfterLogout.body?.error?.code).toBe("INVALID_SESSION");
  });
});
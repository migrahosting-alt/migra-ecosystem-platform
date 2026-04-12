import { DriveTenantStatus, EntitlementStatus, OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { signInWithPassword } from "../helpers/auth";
import {
  createMembership,
  getMigraDrivePlanFixture,
  createOrganization,
  createEntitlement,
  createPasswordResetToken,
  createPlatformConfig,
  createUser,
  createVerificationToken,
  resetDatabase,
} from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";
const starterDrivePlan = getMigraDrivePlanFixture();

describe("Auth integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("signup account cannot login before verification", async () => {
    await createPlatformConfig({
      allowPublicSignup: true,
      allowOrgCreate: true,
      waitlistMode: false,
    });

    const client = new HttpClient(baseUrl);

    const signup = await client.post<{ message?: string }>("/api/auth/signup", {
      json: {
        name: "New Owner",
        email: "pending@example.com",
        password: "VeryStrongPassword123!",
        organizationName: "Pending Org",
      },
    });

    expect(signup.status).toBe(200);
    expect(signup.body?.message).toMatch(/If this email is eligible/i);

    const loginClient = new HttpClient(baseUrl);
    const login = await signInWithPassword(loginClient, "pending@example.com", "VeryStrongPassword123!");
    expect(login.status).toBe(403);
    expect(login.sessionEstablished).toBe(false);

    const driveEntitlement = await prisma.orgEntitlement.findFirst({
      where: {
        org: { slug: "pending-org" },
        product: ProductKey.MIGRADRIVE,
      },
    });
    const driveTenant = await prisma.driveTenant.findFirst({
      where: {
        org: { slug: "pending-org" },
      },
    });

    expect(driveEntitlement?.status).toBe(EntitlementStatus.ACTIVE);
    expect(driveTenant?.status).toBe(DriveTenantStatus.PENDING);
    expect(driveTenant?.planCode).toBe(starterDrivePlan.planCode);
  });

  test("register alias returns starter drive bootstrap payload", async () => {
    await createPlatformConfig({
      allowPublicSignup: true,
      allowOrgCreate: true,
      waitlistMode: false,
    });

    const client = new HttpClient(baseUrl);
    const register = await client.post<{
      ok?: boolean;
      data?: {
        organization?: { slug?: string };
        tenant?: { status?: string; planCode?: string; storageQuotaGb?: number };
        verificationRequired?: boolean;
      };
    }>("/api/auth/register", {
      json: {
        name: "Drive Owner",
        email: "drive-owner@example.com",
        password: "VeryStrongPassword123!",
        organizationName: "Drive Bootstrap Org",
      },
    });

    expect(register.status).toBe(200);
    expect(register.body?.ok).toBe(true);
    expect(register.body?.data?.organization?.slug).toBe("drive-bootstrap-org");
    expect(register.body?.data?.tenant?.status).toBe("PENDING");
    expect(register.body?.data?.tenant?.planCode).toBe(starterDrivePlan.planCode);
    expect(register.body?.data?.tenant?.storageQuotaGb).toBe(starterDrivePlan.storageQuotaGb);
    expect(register.body?.data?.verificationRequired).toBe(true);
  });

  test("verify-email works with valid token and fails generically for invalid token", async () => {
    const user = await createUser({
      email: "verify-me@example.com",
      password: "VerifyPass123!",
      emailVerified: false,
    });

    const org = await createOrganization({
      name: "Verify Org",
      slug: "verify-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

    const knownToken = "known-email-verification-token-1234567890";
    await createVerificationToken({ userId: user.id, token: knownToken });

    const client = new HttpClient(baseUrl);

    const invalid = await client.post<{ error?: string }>("/api/auth/verify-email", {
      json: {
        token: "definitely-not-valid-token-1234567890",
      },
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body?.error).toBe("Invalid verification request.");

    const valid = await client.post<{ message?: string }>("/api/auth/verify-email", {
      json: {
        token: knownToken,
      },
    });

    expect(valid.status).toBe(200);
    expect(valid.body?.message).toMatch(/Email verified/i);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.emailVerified).toBeTruthy();
  });

  test("verified login returns session cookie and access to protected routes", async () => {
    const user = await createUser({
      email: "verified@example.com",
      password: "VerifiedPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Verified Org",
      slug: "verified-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRADRIVE, status: EntitlementStatus.ACTIVE });
    await prisma.driveTenant.create({
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        ...starterDrivePlan,
        status: DriveTenantStatus.ACTIVE,
        activatedAt: new Date(),
      },
    });

    const client = new HttpClient(baseUrl);
    const login = await client.post<{
      ok?: boolean;
      data?: {
        accessToken?: string;
        membership?: { role?: string };
        tenant?: { status?: string };
      };
    }>("/api/auth/login", {
      json: {
        email: "verified@example.com",
        password: "VerifiedPass123!",
      },
    });
    expect(login.status).toBe(200);
    expect(client.hasCookieContaining("session-token")).toBe(true);
    expect(client.hasCookie("migradrive_refresh")).toBe(true);
    expect(login.headers.get("cache-control")).toMatch(/no-store/);
    expect(login.body?.ok).toBe(true);
    expect(login.body?.data?.accessToken).toBeTruthy();
    expect(login.body?.data?.membership?.role).toBe("OWNER");
    expect(login.body?.data?.tenant?.status).toBe("ACTIVE");

    const protectedResult = await client.get("/api/orgs", { withOrigin: false });
    expect(protectedResult.status).toBe(200);

    const meResult = await client.get<{ ok?: boolean; data?: { organization?: { slug?: string } } }>("/api/auth/me", {
      headers: {
        authorization: `Bearer ${login.body?.data?.accessToken}`,
      },
      withOrigin: false,
    });
    expect(meResult.status).toBe(200);
    expect(meResult.body?.ok).toBe(true);
    expect(meResult.body?.data?.organization?.slug).toBe("verified-org");
  });

  test("refresh rotates refresh token and returns a fresh access token", async () => {
    const user = await createUser({
      email: "refreshable@example.com",
      password: "RefreshablePass123!",
      emailVerified: true,
    });
    const org = await createOrganization({
      name: "Refresh Org",
      slug: "refresh-org",
      createdById: user.id,
    });
    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    const login = await client.post<{ data?: { accessToken?: string } }>("/api/auth/login", {
      json: { email: "refreshable@example.com", password: "RefreshablePass123!" },
    });
    expect(login.status).toBe(200);
    const firstRefreshCookie = client.getCookie("migradrive_refresh");
    expect(firstRefreshCookie).toBeTruthy();

    const refresh = await client.post<{ ok?: boolean; data?: { accessToken?: string } }>("/api/auth/refresh");
    expect(refresh.status).toBe(200);
    expect(refresh.body?.ok).toBe(true);
    expect(refresh.body?.data?.accessToken).toBeTruthy();

    const secondRefreshCookie = client.getCookie("migradrive_refresh");
    expect(secondRefreshCookie).toBeTruthy();
    expect(secondRefreshCookie).not.toBe(firstRefreshCookie);
  });

  test("logout clears active cookies and blocks protected routes", async () => {
    const user = await createUser({
      email: "logout@example.com",
      password: "LogoutPass123!",
      emailVerified: true,
    });
    const org = await createOrganization({
      name: "Logout Org",
      slug: "logout-org",
      createdById: user.id,
    });
    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    const login = await signInWithPassword(client, "logout@example.com", "LogoutPass123!");
    expect(login.status).toBe(200);
    expect(client.hasCookieContaining("session-token")).toBe(true);

    const logout = await client.post<{ ok?: boolean }>("/api/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.body?.ok).toBe(true);

    const protectedResult = await client.get("/api/orgs", { withOrigin: false });
    expect(protectedResult.status).toBe(401);

    const refresh = await client.post<{ error?: string }>("/api/auth/refresh");
    expect(refresh.status).toBe(401);
  });

  test("forgot-password is generic for unknown email", async () => {
    const client = new HttpClient(baseUrl);

    const result = await client.post<{ message?: string }>("/api/auth/request-password-reset", {
      json: {
        email: "not-found@example.com",
      },
    });

    expect(result.status).toBe(200);
    expect(result.body?.message).toMatch(/If the account exists/i);
  });

  test("reset-password rotates password and invalidates active sessions", async () => {
    const user = await createUser({
      email: "resettable@example.com",
      password: "OldPassword123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Reset Org",
      slug: "reset-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

    const loggedInClient = new HttpClient(baseUrl);
    const initialLogin = await signInWithPassword(loggedInClient, "resettable@example.com", "OldPassword123!");
    expect(initialLogin.status).toBe(200);
    expect(initialLogin.sessionEstablished).toBe(true);

    const resetToken = "reset-password-token-1234567890";
    await createPasswordResetToken({ userId: user.id, token: resetToken });

    const resetCaller = new HttpClient(baseUrl);
    const resetResponse = await resetCaller.post<{ message?: string }>("/api/auth/reset-password", {
      json: {
        token: resetToken,
        password: "NewPassword123!",
      },
    });

    expect(resetResponse.status).toBe(200);

    const staleSessionRequest = await loggedInClient.get("/api/orgs", { withOrigin: false });
    expect(staleSessionRequest.status).toBe(401);

    const oldPasswordClient = new HttpClient(baseUrl);
    const oldPasswordLogin = await signInWithPassword(oldPasswordClient, "resettable@example.com", "OldPassword123!");
    expect(oldPasswordLogin.status).toBe(401);
    expect(oldPasswordLogin.sessionEstablished).toBe(false);

    const newPasswordClient = new HttpClient(baseUrl);
    const newPasswordLogin = await signInWithPassword(newPasswordClient, "resettable@example.com", "NewPassword123!");
    expect(newPasswordLogin.status).toBe(200);
    expect(newPasswordLogin.sessionEstablished).toBe(true);
  });
});

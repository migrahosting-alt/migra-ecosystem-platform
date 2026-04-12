import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import {
  createMembership,
  createOrganization,
  createPasswordResetToken,
  createUser,
  resetDatabase,
} from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

async function createVerifiedUserFixture(input: {
  email: string;
  password: string;
  name: string;
  orgName: string;
  orgSlug: string;
}) {
  const user = await createUser({
    email: input.email,
    password: input.password,
    emailVerified: true,
    name: input.name,
  });

  const org = await createOrganization({
    name: input.orgName,
    slug: input.orgSlug,
    createdById: user.id,
  });

  await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
  await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

  return { user, org };
}

describe("Auth v1 slice 2 integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("forgot-password is generic and reset-password invalidates existing sessions", async () => {
    const { user } = await createVerifiedUserFixture({
      email: "reset-v1@example.com",
      password: "OldPassword123!",
      name: "Reset V1",
      orgName: "Reset V1 Org",
      orgSlug: "reset-v1-org",
    });

    const loggedInClient = new HttpClient(baseUrl);
    const initialLogin = await loggedInClient.post<{ ok?: boolean }>("/api/v1/auth/login", {
      json: {
        email: "reset-v1@example.com",
        password: "OldPassword123!",
      },
    });
    expect(initialLogin.status).toBe(200);

    const genericClient = new HttpClient(baseUrl);
    const genericForgot = await genericClient.post<{ ok?: boolean; data?: { message?: string } }>("/api/v1/auth/forgot-password", {
      json: {
        email: "missing-reset-v1@example.com",
      },
    });
    expect(genericForgot.status).toBe(200);
    expect(genericForgot.body?.ok).toBe(true);
    expect(genericForgot.body?.data?.message).toMatch(/If the account exists/i);

    const resetToken = "reset-v1-known-token-1234567890";
    await createPasswordResetToken({ userId: user.id, token: resetToken });

    const resetCaller = new HttpClient(baseUrl);
    const resetResponse = await resetCaller.post<{ ok?: boolean; data?: { message?: string } }>("/api/v1/auth/reset-password", {
      json: {
        token: resetToken,
        password: "NewPassword123!",
      },
    });
    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body?.ok).toBe(true);
    expect(resetResponse.body?.data?.message).toMatch(/Password has been reset/i);

    const staleSessionRequest = await loggedInClient.get("/api/v1/me", { withOrigin: false });
    expect(staleSessionRequest.status).toBe(401);

    const oldPasswordClient = new HttpClient(baseUrl);
    const oldPasswordLogin = await oldPasswordClient.post<{ ok?: boolean; error?: { code?: string } }>("/api/v1/auth/login", {
      json: {
        email: "reset-v1@example.com",
        password: "OldPassword123!",
      },
    });
    expect(oldPasswordLogin.status).toBe(401);
    expect(oldPasswordLogin.body?.ok).toBe(false);
    expect(oldPasswordLogin.body?.error?.code).toBe("INVALID_CREDENTIALS");

    const newPasswordClient = new HttpClient(baseUrl);
    const newPasswordLogin = await newPasswordClient.post<{ ok?: boolean }>("/api/v1/auth/login", {
      json: {
        email: "reset-v1@example.com",
        password: "NewPassword123!",
      },
    });
    expect(newPasswordLogin.status).toBe(200);
    expect(newPasswordLogin.body?.ok).toBe(true);
  });

  test("session inventory can revoke another device and logout-all clears the current device", async () => {
    await createVerifiedUserFixture({
      email: "sessions-v1@example.com",
      password: "SessionsPass123!",
      name: "Sessions V1",
      orgName: "Sessions V1 Org",
      orgSlug: "sessions-v1-org",
    });

    const primaryClient = new HttpClient(baseUrl);
    const secondaryClient = new HttpClient(baseUrl);

    const primaryLogin = await primaryClient.post<{ ok?: boolean }>("/api/v1/auth/login", {
      json: {
        email: "sessions-v1@example.com",
        password: "SessionsPass123!",
      },
    });
    const secondaryLogin = await secondaryClient.post<{ ok?: boolean }>("/api/v1/auth/login", {
      json: {
        email: "sessions-v1@example.com",
        password: "SessionsPass123!",
      },
    });
    expect(primaryLogin.status).toBe(200);
    expect(secondaryLogin.status).toBe(200);

    const sessions = await primaryClient.get<{
      ok?: boolean;
      data?: {
        sessions?: Array<{ id: string; current: boolean; userAgent?: string | null }>;
        nextCursor?: string | null;
      };
    }>("/api/v1/auth/sessions", { withOrigin: false });
    expect(sessions.status).toBe(200);
    expect(sessions.body?.ok).toBe(true);
    expect(sessions.body?.data?.sessions).toHaveLength(2);
    expect(sessions.body?.data?.nextCursor).toBeNull();

    const listedSessions = sessions.body?.data?.sessions || [];
    const currentSession = listedSessions.find((session) => session.current);
    const otherSession = listedSessions.find((session) => !session.current);
    expect(currentSession?.id).toBeTruthy();
    expect(otherSession?.id).toBeTruthy();

    if (!otherSession?.id) {
      throw new Error("Expected a second device session to be listed.");
    }

    const revokeOther = await primaryClient.delete<{ ok?: boolean; data?: { message?: string } }>(`/api/v1/auth/sessions/${otherSession.id}`);
    expect(revokeOther.status).toBe(200);
    expect(revokeOther.body?.ok).toBe(true);
    expect(revokeOther.body?.data?.message).toMatch(/Session revoked/i);

    const secondaryAfterRevoke = await secondaryClient.get("/api/v1/me", { withOrigin: false });
    expect(secondaryAfterRevoke.status).toBe(401);

    const securityActivity = await primaryClient.get<{
      ok?: boolean;
      data?: { events?: Array<{ type: string; severity: string }>; nextCursor?: string | null };
    }>("/api/v1/auth/security-activity?limit=10", { withOrigin: false });
    expect(securityActivity.status).toBe(200);
    expect(securityActivity.body?.ok).toBe(true);
    expect(securityActivity.body?.data?.events?.some((event) => event.type === "LOGIN_SUCCEEDED")).toBe(true);
    expect(securityActivity.body?.data?.events?.some((event) => event.type === "SESSION_REVOKED")).toBe(true);

    const logoutAll = await primaryClient.post<{ ok?: boolean; data?: { message?: string } }>("/api/v1/auth/logout-all");
    expect(logoutAll.status).toBe(200);
    expect(logoutAll.body?.ok).toBe(true);
    expect(logoutAll.body?.data?.message).toMatch(/All active sessions invalidated/i);

    const primaryAfterLogoutAll = await primaryClient.get("/api/v1/me", { withOrigin: false });
    expect(primaryAfterLogoutAll.status).toBe(401);
  });
});
import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Invitations integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("create and accept invite with replay rejection and audit events", async () => {
    const admin = await createUser({
      email: "invite-admin@example.com",
      password: "InviteAdminPass123!",
      emailVerified: true,
    });

    const invitee = await createUser({
      email: "invite-user@example.com",
      password: "InviteUserPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Invite Org",
      slug: "invite-org",
      createdById: admin.id,
    });

    await createMembership({ userId: admin.id, orgId: org.id, role: OrgRole.ADMIN });
    await prisma.user.update({ where: { id: admin.id }, data: { defaultOrgId: org.id } });

    const adminClient = new HttpClient(baseUrl);
    await createSessionForUser(adminClient, admin.id);

    const created = await adminClient.post<{ inviteLink?: string; invite?: { id: string } }>(`/api/orgs/${org.id}/invites`, {
      json: {
        email: invitee.email,
        role: OrgRole.BILLING,
      },
    });

    expect(created.status).toBe(201);
    expect(created.body?.invite?.id).toBeTruthy();
    expect(created.body?.inviteLink).toContain("/invite?token=");

    const inviteUrl = new URL(created.body?.inviteLink || "");
    const token = inviteUrl.searchParams.get("token");
    expect(token).toBeTruthy();

    const inviteeClient = new HttpClient(baseUrl);
    await createSessionForUser(inviteeClient, invitee.id);

    const accepted = await inviteeClient.post<{ org?: { id: string } }>("/api/invites/accept", {
      json: {
        token,
      },
    });

    expect(accepted.status).toBe(200);
    expect(accepted.body?.org?.id).toBe(org.id);

    const membership = await prisma.membership.findFirst({
      where: {
        userId: invitee.id,
        orgId: org.id,
      },
    });

    expect(membership?.status).toBe("ACTIVE");
    expect(membership?.role).toBe(OrgRole.BILLING);

    const replay = await inviteeClient.post<{ error?: string }>("/api/invites/accept", {
      json: {
        token,
      },
    });

    expect(replay.status).toBe(400);

    const createdAudit = await prisma.auditLog.findFirst({
      where: {
        userId: admin.id,
        orgId: org.id,
        action: "ORG_INVITE_CREATED",
      },
    });

    const acceptedAudit = await prisma.auditLog.findFirst({
      where: {
        userId: invitee.id,
        orgId: org.id,
        action: "ORG_INVITE_ACCEPTED",
      },
    });

    expect(createdAudit).toBeTruthy();
    expect(acceptedAudit).toBeTruthy();
  });
});

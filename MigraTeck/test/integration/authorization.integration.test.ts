import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Tenancy and RBAC integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("user cannot mutate organization they do not belong to and denial is audited", async () => {
    const actor = await createUser({
      email: "tenant-actor@example.com",
      password: "TenantPass123!",
      emailVerified: true,
    });

    const orgA = await createOrganization({
      name: "Org A",
      slug: "org-a",
      createdById: actor.id,
    });

    const orgB = await createOrganization({
      name: "Org B",
      slug: "org-b",
    });

    await createMembership({ userId: actor.id, orgId: orgA.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: actor.id }, data: { defaultOrgId: orgA.id } });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, actor.id);

    const denied = await client.patch<{ error?: string }>(`/api/orgs/${orgB.id}/settings`, {
      json: {
        name: "Malicious Rename",
      },
    });

    expect(denied.status).toBe(403);
    expect(denied.body?.error).toBe("Forbidden");

    const audit = await prisma.auditLog.findFirst({
      where: {
        userId: actor.id,
        orgId: orgB.id,
        action: "AUTHZ_PERMISSION_DENIED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
  });

  test("MEMBER cannot manage org settings while ADMIN and OWNER can", async () => {
    const actor = await createUser({
      email: "rbac-user@example.com",
      password: "RbacPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "RBAC Org",
      slug: "rbac-org",
      createdById: actor.id,
    });

    const membership = await createMembership({
      userId: actor.id,
      orgId: org.id,
      role: OrgRole.MEMBER,
    });

    await prisma.user.update({ where: { id: actor.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, actor.id);

    const memberDenied = await client.patch<{ error?: string }>(`/api/orgs/${org.id}/settings`, {
      json: {
        name: "RBAC Rename 1",
      },
    });

    expect(memberDenied.status).toBe(403);

    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: OrgRole.ADMIN },
    });

    const adminAllowed = await client.patch<{ org?: { name: string } }>(`/api/orgs/${org.id}/settings`, {
      json: {
        name: "RBAC Rename 2",
      },
    });

    expect(adminAllowed.status).toBe(200);
    expect(adminAllowed.body?.org?.name).toBe("RBAC Rename 2");

    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: OrgRole.OWNER },
    });

    const ownerAllowed = await client.patch<{ org?: { isMigraHostingClient: boolean } }>(`/api/orgs/${org.id}/settings`, {
      json: {
        isMigraHostingClient: true,
      },
    });

    expect(ownerAllowed.status).toBe(200);
    expect(ownerAllowed.body?.org?.isMigraHostingClient).toBe(true);
  });
});

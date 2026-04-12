import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Audit export integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("owner can export CSV/JSON, member is denied, and export is audited", async () => {
    const owner = await createUser({
      email: "audit-owner@example.com",
      password: "AuditOwnerPass123!",
      emailVerified: true,
    });

    const member = await createUser({
      email: "audit-member@example.com",
      password: "AuditMemberPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Audit Org",
      slug: "audit-org",
      createdById: owner.id,
    });

    await createMembership({ userId: owner.id, orgId: org.id, role: OrgRole.OWNER });
    await createMembership({ userId: member.id, orgId: org.id, role: OrgRole.MEMBER });

    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: owner.id,
        action: "TEST_EVENT",
        entityType: "test",
      },
    });

    const ownerClient = new HttpClient(baseUrl);
    await createSessionForUser(ownerClient, owner.id);

    const jsonExport = await ownerClient.get(`/api/audit/export?orgId=${org.id}&format=json`, { withOrigin: false });
    expect(jsonExport.status).toBe(200);
    expect(jsonExport.headers.get("content-type")).toContain("application/json");

    const csvExport = await ownerClient.get(`/api/audit/export?orgId=${org.id}&format=csv`, { withOrigin: false });
    expect(csvExport.status).toBe(200);
    expect(csvExport.headers.get("content-type")).toContain("text/csv");

    const exportAudit = await prisma.auditLog.findMany({
      where: {
        userId: owner.id,
        orgId: org.id,
        action: "AUDIT_EXPORT_CREATED",
      },
    });

    expect(exportAudit.length).toBeGreaterThanOrEqual(2);

    const memberClient = new HttpClient(baseUrl);
    await createSessionForUser(memberClient, member.id);

    const denied = await memberClient.get<{ error?: string }>(`/api/audit/export?orgId=${org.id}&format=json`, {
      withOrigin: false,
    });

    expect(denied.status).toBe(403);

    const deniedAudit = await prisma.auditLog.findFirst({
      where: {
        userId: member.id,
        orgId: org.id,
        action: "AUTHZ_PERMISSION_DENIED",
        entityId: "audit:export",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(deniedAudit).toBeTruthy();
  });
});

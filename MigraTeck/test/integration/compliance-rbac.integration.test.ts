import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { can, type PermissionAction } from "../../src/lib/rbac";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

const ALL_ACTIONS: PermissionAction[] = [
  "ops:read",
  "audit:read",
  "audit:export",
  "org:manage",
  "org:entitlement:view",
  "org:entitlement:edit",
  "org:invite:manage",
  "billing:manage",
  "product:launch",
  "product:request-access",
  "downloads:read",
  "downloads:sign",
  "membership:read",
  "platform:config:manage",
  "builder:read",
  "builder:edit",
  "builder:publish",
  "builder:admin",
  "secrets:read",
  "secrets:manage",
  "compliance:read",
  "compliance:manage",
  "backup:read",
  "backup:manage",
  "access-review:read",
  "access-review:manage",
  "incidents:read",
  "incidents:manage",
];

const EXPECTED_ACTIONS: Record<OrgRole, PermissionAction[]> = {
  OWNER: [
    "ops:read",
    "audit:read",
    "audit:export",
    "org:manage",
    "org:entitlement:view",
    "org:entitlement:edit",
    "org:invite:manage",
    "billing:manage",
    "product:launch",
    "product:request-access",
    "downloads:read",
    "downloads:sign",
    "membership:read",
    "platform:config:manage",
    "builder:read",
    "builder:edit",
    "builder:publish",
    "builder:admin",
    "secrets:read",
    "secrets:manage",
    "compliance:read",
    "compliance:manage",
    "backup:read",
    "backup:manage",
    "access-review:read",
    "access-review:manage",
    "incidents:read",
    "incidents:manage",
  ],
  ADMIN: [
    "ops:read",
    "audit:read",
    "audit:export",
    "org:manage",
    "org:entitlement:view",
    "org:entitlement:edit",
    "org:invite:manage",
    "billing:manage",
    "product:launch",
    "product:request-access",
    "downloads:read",
    "downloads:sign",
    "membership:read",
    "builder:read",
    "builder:edit",
    "builder:publish",
    "builder:admin",
    "secrets:read",
    "secrets:manage",
    "compliance:read",
    "compliance:manage",
    "backup:read",
    "backup:manage",
    "access-review:read",
    "access-review:manage",
    "incidents:read",
    "incidents:manage",
  ],
  BILLING: [
    "audit:read",
    "org:entitlement:view",
    "billing:manage",
    "product:launch",
    "product:request-access",
    "downloads:read",
    "downloads:sign",
    "membership:read",
    "compliance:read",
    "backup:read",
    "incidents:read",
  ],
  MEMBER: [
    "org:entitlement:view",
    "product:launch",
    "product:request-access",
    "downloads:read",
    "downloads:sign",
    "membership:read",
    "builder:read",
    "builder:edit",
    "compliance:read",
    "incidents:read",
  ],
  READONLY: [
    "audit:read",
    "org:entitlement:view",
    "product:request-access",
    "downloads:read",
    "membership:read",
    "builder:read",
    "compliance:read",
  ],
};

describe("Compliance RBAC matrix", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("role permission matrix matches the expected policy contract", () => {
    for (const role of Object.values(OrgRole)) {
      const allowed = new Set(EXPECTED_ACTIONS[role]);
      for (const action of ALL_ACTIONS) {
        expect(can(role, action)).toBe(allowed.has(action));
      }
    }
  });

  test("compliance and backup routes enforce read/manage permissions by role", async () => {
    const actor = await createUser({
      email: "compliance-rbac@example.com",
      password: "ProofPass123!",
      emailVerified: true,
    });
    const org = await createOrganization({
      name: "Compliance RBAC Org",
      slug: "compliance-rbac-org",
      createdById: actor.id,
    });
    const membership = await createMembership({ userId: actor.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: actor.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, actor.id);

    for (const role of Object.values(OrgRole)) {
      await prisma.membership.update({ where: { id: membership.id }, data: { role } });

      const retentionReport = await client.get("/api/compliance/reports/retention");
      expect(retentionReport.status).toBe(can(role, "compliance:read") ? 200 : 403);

      const backupReport = await client.get("/api/compliance/reports/backups");
      expect(backupReport.status).toBe(can(role, "backup:read") ? 200 : 403);

      const createRetention = await client.post("/api/compliance/retention", {
        json: {
          entityType: role === OrgRole.ADMIN ? "PlatformEvent" : "SecurityEvent",
          retentionDays: 30,
          description: `phase-g-proof-${role.toLowerCase()}`,
        },
      });
      expect(createRetention.status).toBe(can(role, "compliance:manage") ? 201 : 403);
    }
  });
});
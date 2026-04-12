import { DriveTenantStatus, OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  resetDatabase,
  createUser,
  createOrganization,
  createMembership,
  getMigraDrivePlanFixture,
} from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

const baseEnv = { ...process.env };
const starterDrivePlan = getMigraDrivePlanFixture();
const businessDrivePlan = getMigraDrivePlanFixture("business");

function makeRequest(path: string, body: unknown, token = "drive-test-token") {
  return new NextRequest(`http://127.0.0.1:3109/api/internal/drive-provision${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-idempotency-key": `idem_${Date.now()}_${Math.random()}`,
    },
    body: JSON.stringify(body),
  });
}

describe("MigraDrive provisioning integration", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDatabase();
    vi.resetModules();
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      MIGRADRIVE_INTERNAL_PROVISION_TOKEN: "drive-test-token",
    };

    const user = await createUser({ email: "drive-test@example.com", password: "TestPass123!" });
    const org = await createOrganization({ name: "Drive Test Org", slug: "drive-test-org", createdById: user.id });
    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    orgId = org.id;
  });

  // ── Test 1: First purchase provisions tenant ────────────

  test("first purchase provisions a new drive tenant", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");

    const response = await POST(makeRequest("", {
      idempotencyKey: "first_purchase_001",
      orgId,
      orgSlug: "drive-test-org",
      ...businessDrivePlan,
      subscriptionId: "sub_test_001",
      entitlementId: "ent_test_001",
      customerId: "cus_test_001",
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.tenantId).toBeTruthy();
    expect(body.externalRef).toBeTruthy();
    expect(body.status).toBe("completed");
    expect(body.planCode).toBe(businessDrivePlan.planCode);
    expect(body.storageQuotaGb).toBe(businessDrivePlan.storageQuotaGb);

    // Verify DB record
    const tenant = await prisma.driveTenant.findUnique({ where: { orgId } });
    expect(tenant).toBeTruthy();
    expect(tenant!.orgSlug).toBe("drive-test-org");
    expect(tenant!.planCode).toBe(businessDrivePlan.planCode);
    expect(tenant!.storageQuotaGb).toBe(businessDrivePlan.storageQuotaGb);
    expect(tenant!.status).toBe(DriveTenantStatus.ACTIVE);
    expect(tenant!.subscriptionId).toBe("sub_test_001");
    expect(tenant!.entitlementId).toBe("ent_test_001");
  });

  // ── Test 2: Repeated webhook does not create second tenant

  test("repeated provision request returns 409 without duplicate", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");

    // First provision
    const first = await POST(makeRequest("", {
      idempotencyKey: "dup_001",
      orgId,
      orgSlug: "drive-test-org",
      ...starterDrivePlan,
    }));
    expect(first.status).toBe(200);

    // Second identical request
    const second = await POST(makeRequest("", {
      idempotencyKey: "dup_002",
      orgId,
      orgSlug: "drive-test-org",
      ...starterDrivePlan,
    }));

    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("already_provisioned");

    // Only one tenant exists
    const count = await prisma.driveTenant.count({ where: { orgId } });
    expect(count).toBe(1);
  });

  // ── Test 3: Upgrade changes quota correctly ─────────────

  test("upgrade from starter to business updates plan and quota", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");

    // Initial provision
    await POST(makeRequest("", {
      idempotencyKey: "upgrade_001",
      orgId,
      orgSlug: "drive-test-org",
      ...starterDrivePlan,
    }));

    // Upgrade
    const upgrade = await POST(makeRequest("", {
      idempotencyKey: "upgrade_002",
      orgId,
      orgSlug: "drive-test-org",
      ...businessDrivePlan,
      subscriptionId: "sub_upgraded_001",
    }));

    expect(upgrade.status).toBe(200);
    const body = await upgrade.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("upgraded");
    expect(body.planCode).toBe(businessDrivePlan.planCode);
    expect(body.storageQuotaGb).toBe(businessDrivePlan.storageQuotaGb);

    // Verify single updated record
    const tenants = await prisma.driveTenant.findMany({ where: { orgId } });
    expect(tenants.length).toBe(1);
    expect(tenants[0]?.planCode).toBe(businessDrivePlan.planCode);
    expect(tenants[0]?.storageQuotaGb).toBe(businessDrivePlan.storageQuotaGb);
    expect(tenants[0]?.subscriptionId).toBe("sub_upgraded_001");
  });

  // ── Test 4: Disable disables without deleting data ──────

  test("disable sets status to DISABLED without deleting tenant", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");
    const { POST: DISABLE_POST } = await import("../../src/app/api/internal/drive-provision/disable/route");

    // Provision first
    const provision = await POST(makeRequest("", {
      idempotencyKey: "disable_001",
      orgId,
      orgSlug: "drive-test-org",
      ...businessDrivePlan,
    }));
    expect(provision.status).toBe(200);
    const { tenantId } = await provision.json();

    // Disable
    const disable = await DISABLE_POST(makeRequest("/disable", {
      orgId,
    }));

    expect(disable.status).toBe(200);
    const body = await disable.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("disabled");
    expect(body.tenantId).toBe(tenantId);

    // Verify record still exists but disabled
    const tenant = await prisma.driveTenant.findUnique({ where: { id: tenantId } });
    expect(tenant).toBeTruthy();
    expect(tenant!.status).toBe(DriveTenantStatus.DISABLED);
    expect(tenant!.disabledAt).toBeTruthy();
    // Data preserved
    expect(tenant!.planCode).toBe(businessDrivePlan.planCode);
    expect(tenant!.storageQuotaGb).toBe(businessDrivePlan.storageQuotaGb);
  });

  // ── Test 5: Disable after already-disabled is idempotent ─

  test("disable on already disabled tenant returns 409", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");
    const { POST: DISABLE_POST } = await import("../../src/app/api/internal/drive-provision/disable/route");

    // Provision
    await POST(makeRequest("", {
      idempotencyKey: "disable_idem_001",
      orgId,
      orgSlug: "drive-test-org",
      ...starterDrivePlan,
    }));

    // Disable
    await DISABLE_POST(makeRequest("/disable", { orgId }));

    // Disable again
    const second = await DISABLE_POST(makeRequest("/disable", { orgId }));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("already_disabled");
  });

  // ── Test 6: Re-provision after disable reactivates ──────

  test("provision after disable reactivates tenant", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");
    const { POST: DISABLE_POST } = await import("../../src/app/api/internal/drive-provision/disable/route");

    // Provision
    const initial = await POST(makeRequest("", {
      idempotencyKey: "reactivate_001",
      orgId,
      orgSlug: "drive-test-org",
      ...starterDrivePlan,
    }));
    const { tenantId } = await initial.json();

    // Disable
    await DISABLE_POST(makeRequest("/disable", { orgId }));

    // Re-provision with upgraded plan
    const reactivate = await POST(makeRequest("", {
      idempotencyKey: "reactivate_002",
      orgId,
      orgSlug: "drive-test-org",
      ...businessDrivePlan,
    }));

    expect(reactivate.status).toBe(200);
    const body = await reactivate.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("reactivated");
    expect(body.tenantId).toBe(tenantId);
    expect(body.planCode).toBe(businessDrivePlan.planCode);
    expect(body.storageQuotaGb).toBe(businessDrivePlan.storageQuotaGb);

    // Verify record reactivated
    const tenant = await prisma.driveTenant.findUnique({ where: { id: tenantId } });
    expect(tenant!.status).toBe(DriveTenantStatus.ACTIVE);
    expect(tenant!.disabledAt).toBeNull();
    expect(tenant!.planCode).toBe(businessDrivePlan.planCode);
    expect(tenant!.storageQuotaGb).toBe(businessDrivePlan.storageQuotaGb);
  });

  // ── Auth guard tests ────────────────────────────────────

  test("rejects unauthenticated requests", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");

    const response = await POST(makeRequest("", {
      idempotencyKey: "auth_001",
      orgId,
      orgSlug: "drive-test-org",
      ...starterDrivePlan,
    }, "wrong-token"));

    expect(response.status).toBe(401);
  });

  test("rejects requests with no token", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");

    const response = await POST(makeRequest("", {
      idempotencyKey: "auth_002",
      orgId,
      orgSlug: "drive-test-org",
      ...starterDrivePlan,
    }, ""));

    expect(response.status).toBe(401);
  });

  test("rejects invalid payload", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");

    const response = await POST(makeRequest("", {
      idempotencyKey: "bad_001",
      // Missing orgId, plan, storageQuotaGb
    }));

    expect(response.status).toBe(400);
  });

  test("returns 404 for non-existent organization", async () => {
    const { POST } = await import("../../src/app/api/internal/drive-provision/route");

    const response = await POST(makeRequest("", {
      idempotencyKey: "missing_001",
      orgId: "non_existent_org_id",
      orgSlug: "missing-org",
      ...starterDrivePlan,
    }));

    expect(response.status).toBe(404);
  });
});

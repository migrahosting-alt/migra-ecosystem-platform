import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

async function createOwnerClient() {
  const owner = await createUser({
    email: "phase-g-owner@example.com",
    password: "ProofPass123!",
    emailVerified: true,
    name: "Phase G Owner",
  });
  const org = await createOrganization({
    name: "Phase G Org",
    slug: "phase-g-org",
    createdById: owner.id,
  });
  await createMembership({ userId: owner.id, orgId: org.id, role: OrgRole.OWNER });
  await prisma.user.update({ where: { id: owner.id }, data: { defaultOrgId: org.id } });

  const client = new HttpClient(baseUrl);
  await createSessionForUser(client, owner.id);

  return { client, owner, org };
}

describe("Phase G scenarios", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("scenario 1: access review lifecycle completes and applies decisions", async () => {
    const { client } = await createOwnerClient();

    const created = await client.post<{ review?: { id: string; entries: Array<{ id: string }> } }>(
      "/api/compliance/access-reviews",
      {
        json: {
          title: "Quarterly owner review",
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    );
    expect(created.status).toBe(201);

    const entryId = created.body?.review?.entries[0]?.id;
    expect(entryId).toBeTruthy();

    const decided = await client.patch("/api/compliance/access-reviews", {
      json: {
        action: "decide",
        entryId,
        decision: "KEEP",
      },
    });
    expect(decided.status).toBe(200);

    const completed = await client.patch("/api/compliance/access-reviews", {
      json: {
        action: "complete",
        reviewId: created.body?.review?.id,
      },
    });
    expect(completed.status).toBe(200);

    const applied = await client.patch("/api/compliance/access-reviews", {
      json: {
        action: "apply",
        reviewId: created.body?.review?.id,
      },
    });
    expect(applied.status).toBe(200);
  });

  test("scenario 2: deletion request lifecycle issues a completion certificate", async () => {
    const { client, owner, org } = await createOwnerClient();

    const requested = await client.post<{ request?: { id: string } }>("/api/compliance/deletion", {
      json: {
        subjectEmail: owner.email,
        subjectUserId: owner.id,
        categories: ["personal"],
      },
    });
    expect(requested.status).toBe(201);

    const approved = await client.patch("/api/compliance/deletion", {
      json: {
        requestId: requested.body?.request?.id,
        action: "approve",
      },
    });
    expect(approved.status).toBe(200);

    const executed = await client.patch<{ result?: { requestId: string } }>("/api/compliance/deletion", {
      json: {
        requestId: requested.body?.request?.id,
        action: "execute",
      },
    });
    expect(executed.status).toBe(200);

    const certificate = await client.get<{ certificate?: { requestId: string } }>(
      `/api/compliance/deletion?certId=${requested.body?.request?.id}`,
    );
    expect(certificate.status).toBe(200);
    expect(certificate.body?.certificate?.requestId).toBe(requested.body?.request?.id);

    const redacted = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(redacted.email).toBeNull();
    expect(org.id).toBeTruthy();
  });

  test("scenario 3: retention policy creation surfaces in the retention report", async () => {
    const { client } = await createOwnerClient();

    const created = await client.post<{ policy?: { id: string } }>("/api/compliance/retention", {
      json: {
        entityType: "WebhookDelivery",
        retentionDays: 14,
        description: "Phase G scenario proof",
      },
    });
    expect(created.status).toBe(201);

    const report = await client.get<{ policy?: { id: string } }>(
      `/api/compliance/reports/retention?policyId=${created.body?.policy?.id}`,
    );
    expect(report.status).toBe(200);
    expect(report.body?.policy?.id).toBe(created.body?.policy?.id);
  });

  test("scenario 4: incident lifecycle produces a scoped incident report", async () => {
    const { client } = await createOwnerClient();

    const created = await client.post<{ incident?: { id: string } }>("/api/compliance/incidents", {
      json: {
        title: "Phase G incident",
        severity: "SEV3",
        description: "Scenario validation",
      },
    });
    expect(created.status).toBe(201);

    const updated = await client.patch<{ incident?: { status: string } }>("/api/compliance/incidents", {
      json: {
        incidentId: created.body?.incident?.id,
        status: "MITIGATED",
        mitigationSteps: "Validated mitigation path",
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body?.incident?.status).toBe("MITIGATED");

    const report = await client.get<{ incident?: { id: string; status: string } }>(
      `/api/compliance/reports/incidents/${created.body?.incident?.id}`,
    );
    expect(report.status).toBe(200);
    expect(report.body?.incident?.id).toBe(created.body?.incident?.id);
  });

  test("scenario 5: environment configuration lifecycle returns summary state", async () => {
    const { client } = await createOwnerClient();

    const created = await client.post<{ config?: { id: string } }>("/api/compliance/environments", {
      json: {
        tier: "TESTING",
        name: "phase-g-testing",
        configJson: { region: "us-east-1", purpose: "phase-g" },
        isolationLevel: "logical",
        isDefault: true,
      },
    });
    expect(created.status).toBe(201);

    const updated = await client.patch<{ config?: { isolationLevel: string } }>("/api/compliance/environments", {
      json: {
        configId: created.body?.config?.id,
        isolationLevel: "physical",
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body?.config?.isolationLevel).toBe("physical");

    const summary = await client.get<{ summary?: { total: number } }>("/api/compliance/environments?summary=true");
    expect(summary.status).toBe(200);
    expect(summary.body?.summary?.total).toBeGreaterThanOrEqual(1);
  });
});
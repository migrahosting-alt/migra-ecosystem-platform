import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createAccessReview } from "../../src/lib/access-review";
import {
  completeBackup,
  createBackupRecord,
  recordRestoreTest,
  startBackup,
  validateBackupIntegrity,
} from "../../src/lib/backup-validation";
import { createIncident } from "../../src/lib/compliance-runbooks";
import { createRetentionPolicy, enforceRetentionPolicy } from "../../src/lib/retention";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Compliance report routes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("report endpoints return scoped compliance proof data", async () => {
    const actor = await createUser({
      email: "reports-owner@example.com",
      password: "ProofPass123!",
      emailVerified: true,
      name: "Reports Owner",
    });
    const reviewer = await createUser({
      email: "reports-reviewer@example.com",
      password: "ProofPass123!",
      emailVerified: true,
      name: "Reports Reviewer",
    });
    const org = await createOrganization({
      name: "Reports Org",
      slug: "reports-org",
      createdById: actor.id,
    });
    await createMembership({ userId: actor.id, orgId: org.id, role: OrgRole.OWNER });
    await createMembership({ userId: reviewer.id, orgId: org.id, role: OrgRole.MEMBER });
    await prisma.user.update({ where: { id: actor.id }, data: { defaultOrgId: org.id } });

    const review = await createAccessReview({
      orgId: org.id,
      title: "Quarterly access review",
      initiatedById: actor.id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const backupPayload = Buffer.from("compliance-report-backup", "utf8");
    const backup = await createBackupRecord({
      orgId: org.id,
      backupType: "full",
      initiatedById: actor.id,
    });
    await startBackup(backup.id);
    await completeBackup(backup.id, {
      storagePath: "s3://proof/full.tar.zst",
      sizeBytes: BigInt(backupPayload.length),
      checksumSha256: "report-backup-checksum",
    });
    await validateBackupIntegrity(backup.id, "report-backup-checksum", actor.id);
    await recordRestoreTest(backup.id, true, { restored: true }, actor.id);

    await prisma.securityEvent.create({
      data: {
        orgId: org.id,
        userId: actor.id,
        eventType: "RETENTION_REPORT",
        severity: "INFO",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });
    const policy = await createRetentionPolicy({
      orgId: org.id,
      entityType: "SecurityEvent",
      retentionDays: 1,
      action: "DELETE",
      description: "Report policy",
    });
    await enforceRetentionPolicy(policy.id);

    const incident = await createIncident({
      orgId: org.id,
      title: "Control plane auth incident",
      severity: "SEV2",
      reportedById: actor.id,
      description: "Scoped report validation",
    });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, actor.id);

    const accessReviewReport = await client.get<{ report?: { reviewId: string } }>(
      `/api/compliance/reports/access-review?reviewId=${review.id}`,
    );
    expect(accessReviewReport.status).toBe(200);
    expect(accessReviewReport.body?.report?.reviewId).toBe(review.id);

    const retentionReport = await client.get<{ policy?: { id: string } }>(
      `/api/compliance/reports/retention?policyId=${policy.id}`,
    );
    expect(retentionReport.status).toBe(200);
    expect(retentionReport.body?.policy?.id).toBe(policy.id);

    const backupReport = await client.get<{ backup?: { id: string }; validations?: unknown[] }>(
      `/api/compliance/reports/backups?backupId=${backup.id}`,
    );
    expect(backupReport.status).toBe(200);
    expect(backupReport.body?.backup?.id).toBe(backup.id);
    expect(backupReport.body?.validations?.length).toBe(2);

    const incidentReport = await client.get<{ incident?: { id: string } }>(
      `/api/compliance/reports/incidents/${incident.id}`,
    );
    expect(incidentReport.status).toBe(200);
    expect(incidentReport.body?.incident?.id).toBe(incident.id);
  });
});
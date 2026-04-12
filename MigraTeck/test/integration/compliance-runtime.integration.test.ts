import { OrgRole, SecretScope } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { writeAuditLog } from "../../src/lib/audit";
import {
  canModifyAuditRecord,
  createAuditRetentionRule,
  validateRetentionAgainstImmutability,
} from "../../src/lib/audit-rules";
import {
  completeBackup,
  createBackupRecord,
  getBackupSummary,
  recordRestoreTest,
  startBackup,
  validateBackupIntegrity,
} from "../../src/lib/backup-validation";
import {
  approveDeletion,
  executeDeletion,
  getDeletionCertificate,
  requestDataDeletion,
} from "../../src/lib/data-deletion";
import {
  cleanupExpiredBlobs,
  computeSha256,
  decryptBuffer,
  encryptBuffer,
  registerEncryptedBlob,
} from "../../src/lib/encrypted-storage";
import {
  createEnvironmentConfig,
  resolveOrgEnvironment,
  validateEnvironmentIsolation,
} from "../../src/lib/environment";
import { createRetentionPolicy, enforceRetentionPolicy } from "../../src/lib/retention";
import { createSecret, getSecretValue, rotateSecret } from "../../src/lib/secrets";
import { recordSecurityEvent } from "../../src/lib/security/security-events";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

const PLATFORM_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Compliance runtime proof", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.PLATFORM_ENCRYPTION_KEY = PLATFORM_ENCRYPTION_KEY;
  });

  test("verifies secret encryption, rotation, and encrypted blob expiry cleanup", async () => {
    const actor = await createUser({
      email: "crypto-proof@example.com",
      password: "ProofPass123!",
      emailVerified: true,
    });
    const org = await createOrganization({
      name: "Crypto Proof Org",
      slug: "crypto-proof-org",
      createdById: actor.id,
    });
    await createMembership({ userId: actor.id, orgId: org.id, role: OrgRole.OWNER });

    const secret = await createSecret({
      orgId: org.id,
      scope: SecretScope.ORGANIZATION,
      name: "smtp_password",
      value: "initial-secret",
      createdById: actor.id,
    });

    expect(await getSecretValue(secret.id)).toBe("initial-secret");

    await rotateSecret(secret.id, "rotated-secret");
    expect(await getSecretValue(secret.id)).toBe("rotated-secret");

    const plaintext = Buffer.from("phase-g-runtime-proof", "utf8");
    const encrypted = encryptBuffer(plaintext, 2);
    expect(decryptBuffer(encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion).toString("utf8"))
      .toBe("phase-g-runtime-proof");

    await registerEncryptedBlob({
      orgId: org.id,
      bucketName: "compliance-proof",
      objectKey: "expired.bin",
      checksumSha256: computeSha256(plaintext),
      expiresAt: new Date(Date.now() - 60_000),
      createdById: actor.id,
    });

    expect(await cleanupExpiredBlobs()).toBe(1);
  });

  test("verifies backup integrity validation and restore proof", async () => {
    const actor = await createUser({
      email: "backup-proof@example.com",
      password: "ProofPass123!",
      emailVerified: true,
    });
    const org = await createOrganization({
      name: "Backup Proof Org",
      slug: "backup-proof-org",
      createdById: actor.id,
    });

    const payload = Buffer.from("backup-payload-v1", "utf8");
    const backup = await createBackupRecord({
      orgId: org.id,
      backupType: "database",
      initiatedById: actor.id,
      retentionDays: 7,
    });

    await startBackup(backup.id);
    await completeBackup(backup.id, {
      storagePath: "s3://proof/database.dump",
      sizeBytes: BigInt(payload.length),
      checksumSha256: computeSha256(payload),
    });

    const integrity = await validateBackupIntegrity(backup.id, computeSha256(payload), actor.id);
    const restore = await recordRestoreTest(backup.id, true, { restored: true, target: "staging" }, actor.id);
    const summary = await getBackupSummary();

    expect(integrity.passed).toBe(true);
    expect(restore.passed).toBe(true);
    expect(summary.verified).toBeGreaterThanOrEqual(1);
  });

  test("verifies retention enforcement and immutable audit policy checks", async () => {
    const actor = await createUser({
      email: "retention-proof@example.com",
      password: "ProofPass123!",
      emailVerified: true,
    });
    const org = await createOrganization({
      name: "Retention Proof Org",
      slug: "retention-proof-org",
      createdById: actor.id,
    });

    await createAuditRetentionRule({
      name: "Audit immutable 90d",
      entityType: "AuditLog",
      minRetentionDays: 90,
      preventDeletion: true,
      preventModification: true,
    });

    const retentionCheck = await validateRetentionAgainstImmutability("AuditLog", 30);
    const modifyCheck = await canModifyAuditRecord("AuditLog");

    expect(retentionCheck.allowed).toBe(false);
    expect(modifyCheck.allowed).toBe(false);

    await prisma.securityEvent.create({
      data: {
        orgId: org.id,
        userId: actor.id,
        eventType: "RETENTION_PROOF",
        severity: "WARNING",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    const policy = await createRetentionPolicy({
      orgId: org.id,
      entityType: "SecurityEvent",
      retentionDays: 1,
      action: "DELETE",
      description: "Phase G proof policy",
    });

    const result = await enforceRetentionPolicy(policy.id);
    expect(result.recordsAffected).toBe(1);
    expect(await prisma.securityEvent.count()).toBe(0);
  });

  test("verifies GDPR deletion cascade, certificate generation, and environment isolation", async () => {
    const actor = await createUser({
      email: "deletion-proof@example.com",
      password: "ProofPass123!",
      emailVerified: true,
      name: "Deletion Proof",
    });
    const org = await createOrganization({
      name: "Deletion Proof Org",
      slug: "deletion-proof-org",
      createdById: actor.id,
    });
    await createMembership({ userId: actor.id, orgId: org.id, role: OrgRole.OWNER });

    await writeAuditLog({
      actorId: actor.id,
      orgId: org.id,
      action: "ACCOUNT_UPDATED",
    });
    await recordSecurityEvent({
      userId: actor.id,
      orgId: org.id,
      eventType: "SESSION_ANOMALY",
      metadata: { proof: true },
    });

    const request = await requestDataDeletion({
      orgId: org.id,
      requestedById: actor.id,
      subjectEmail: actor.email!,
      subjectUserId: actor.id,
      categories: ["audit", "security", "personal"],
      reason: "Phase G deletion proof",
    });
    await approveDeletion(request.id, actor.id);
    const execution = await executeDeletion(request.id);
    const certificate = await getDeletionCertificate(request.id);
    const redactedUser = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });

    expect(execution.summary.audit).toBe(1);
    expect(execution.summary.security).toBe(1);
    expect(execution.summary.personal).toBe(1);
    expect(certificate.certHash).toHaveLength(64);
    expect(redactedUser.name).toBe("[REDACTED]");
    expect(redactedUser.email).toBeNull();

    await createEnvironmentConfig({
      tier: "PRODUCTION",
      name: "prod-default",
      configJson: { region: "us-east-1" },
      isDefault: true,
      isolationLevel: "physical",
    });
    await createEnvironmentConfig({
      tier: "TESTING",
      name: "test-org-bound",
      configJson: { region: "us-east-1" },
      allowedOrgIds: [org.id],
      isolationLevel: "logical",
    });

    const testingEnv = await resolveOrgEnvironment(org.id, "TESTING");
    const isolation = validateEnvironmentIsolation("TESTING", "PRODUCTION");

    expect(testingEnv?.name).toBe("test-org-bound");
    expect(isolation.allowed).toBe(false);
  });
});
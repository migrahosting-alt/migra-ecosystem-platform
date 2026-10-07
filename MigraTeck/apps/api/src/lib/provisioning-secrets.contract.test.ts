import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProvisioningSecretError,
  decryptProvisioningSecretValue,
  encryptProvisioningSecretValue,
} from "./provisioning-secrets.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const previousKey = process.env.PROVISIONING_SECRET_ENCRYPTION_KEY;
process.env.PROVISIONING_SECRET_ENCRYPTION_KEY = "42".repeat(32);

test.after(() => {
  if (previousKey === undefined) {
    delete process.env.PROVISIONING_SECRET_ENCRYPTION_KEY;
  } else {
    process.env.PROVISIONING_SECRET_ENCRYPTION_KEY = previousKey;
  }
});

test("provisioning secret round-trips with authenticated encryption", () => {
  const identity = {
    orgId: "org_test_001",
    secretId: "secret_test_001",
    jobId: "job_test_001",
  };
  const envelope = encryptProvisioningSecretValue({
    ...identity,
    plaintext: "StrongMailboxPass123!",
  });

  assert.equal(envelope.keyVersion, 1);
  assert.notEqual(envelope.encryptedValue, "StrongMailboxPass123!");
  assert.equal(
    decryptProvisioningSecretValue({
      ...identity,
      ...envelope,
    }),
    "StrongMailboxPass123!",
  );
});

test("provisioning secret AAD prevents cross-org or cross-job reuse", () => {
  const identity = {
    orgId: "org_test_001",
    secretId: "secret_test_001",
    jobId: "job_test_001",
  };
  const envelope = encryptProvisioningSecretValue({
    ...identity,
    plaintext: "StrongMailboxPass123!",
  });

  assert.throws(
    () =>
      decryptProvisioningSecretValue({
        ...identity,
        orgId: "org_other",
        ...envelope,
      }),
    ProvisioningSecretError,
  );
  assert.throws(
    () =>
      decryptProvisioningSecretValue({
        ...identity,
        jobId: "job_other",
        ...envelope,
      }),
    ProvisioningSecretError,
  );
});

test("tampering with ciphertext fails authenticated decryption", () => {
  const identity = {
    orgId: "org_test_001",
    secretId: "secret_test_001",
    jobId: "job_test_001",
  };
  const envelope = encryptProvisioningSecretValue({
    ...identity,
    plaintext: "StrongMailboxPass123!",
  });
  const bytes = Buffer.from(envelope.encryptedValue, "base64");
  bytes[0] = bytes[0]! ^ 0xff;

  assert.throws(
    () =>
      decryptProvisioningSecretValue({
        ...identity,
        ...envelope,
        encryptedValue: bytes.toString("base64"),
      }),
    ProvisioningSecretError,
  );
});

test("missing encryption key fails closed as retryable configuration error", () => {
  const current = process.env.PROVISIONING_SECRET_ENCRYPTION_KEY;
  delete process.env.PROVISIONING_SECRET_ENCRYPTION_KEY;
  try {
    assert.throws(
      () =>
        encryptProvisioningSecretValue({
          plaintext: "StrongMailboxPass123!",
          orgId: "org_test_001",
          secretId: "secret_test_001",
          jobId: "job_test_001",
        }),
      (error: unknown) =>
        error instanceof ProvisioningSecretError &&
        error.code === "provisioning_secret_key_unavailable" &&
        error.retryable,
    );
  } finally {
    if (current !== undefined) {
      process.env.PROVISIONING_SECRET_ENCRYPTION_KEY = current;
    }
  }
});

test("MigraMail provisioning persists only an opaque secret reference", () => {
  const entitlement = repoFile("apps/api/src/lib/commerce-entitlements.ts");
  const provider = repoFile("apps/api/src/lib/provisioning-provider.ts");
  const worker = repoFile("apps/api/src/provisioning-worker.ts");

  assert.ok(
    entitlement.includes(
      "const { mailboxPassword, ...persistableContext } = input.context",
    ),
  );
  assert.ok(entitlement.includes("createProvisioningSecret(client"));
  assert.ok(entitlement.includes("mailboxSecretRef"));
  assert.ok(
    !entitlement.includes(
      "const payload = {\n    action: input.action,\n    product: input.product,\n    productLane: input.product,\n    previousStatus: input.previousStatus,\n    newStatus: input.newStatus,\n    transitionId: input.transitionId,\n    operatorReason: input.reason,\n    ...input.context",
    ),
  );

  assert.ok(provider.includes("readProvisioningSecret(secretIdentity)"));
  assert.ok(provider.includes("deleteProvisioningSecret(secretIdentity)"));
  assert.ok(
    provider.includes(
      "mailboxSecretRef: asString(payload.mailboxSecretRef)",
    ),
  );
  assert.ok(!provider.includes("asString(payload.mailboxPassword)"));

  assert.ok(worker.includes("cleanupExpiredProvisioningSecrets"));
});

test("dead-letter recovery strips both old plaintext and one-time secret references", () => {
  const remediation = repoFile("apps/api/src/lib/provisioning-remediation.ts");
  assert.ok(remediation.includes("delete payload.mailboxPassword"));
  assert.ok(remediation.includes("delete payload.mailboxSecretRef"));
});

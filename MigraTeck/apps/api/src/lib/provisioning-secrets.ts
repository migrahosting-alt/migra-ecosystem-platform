import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";

const KEY_ENV = "PROVISIONING_SECRET_ENCRYPTION_KEY";
const KEY_VERSION = 1;
const PREFIX = "provisioning:migramail:";

export class ProvisioningSecretError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ProvisioningSecretError";
    this.code = code;
    this.retryable = retryable;
  }
}

function encryptionKey(): Buffer {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new ProvisioningSecretError(
      "provisioning_secret_key_unavailable",
      KEY_ENV + " must be configured as a 64-character hex key",
      true,
    );
  }
  return Buffer.from(raw, "hex");
}

function aad(orgId: string, secretId: string, jobId: string): Buffer {
  return Buffer.from(
    ["migrateck", "provisioning-secret", "v1", orgId, secretId, jobId].join(":"),
    "utf8",
  );
}

export function encryptProvisioningSecretValue(input: {
  plaintext: string;
  orgId: string;
  secretId: string;
  jobId: string;
}): {
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyVersion: number;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad(input.orgId, input.secretId, input.jobId));
  const encrypted = Buffer.concat([
    cipher.update(input.plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptProvisioningSecretValue(input: {
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  orgId: string;
  secretId: string;
  jobId: string;
}): string {
  if (input.keyVersion !== KEY_VERSION) {
    throw new ProvisioningSecretError(
      "provisioning_secret_key_version_unsupported",
      "Unsupported provisioning secret key version",
      false,
    );
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(input.iv, "base64"),
    );
    decipher.setAAD(aad(input.orgId, input.secretId, input.jobId));
    decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(input.encryptedValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof ProvisioningSecretError) throw error;
    throw new ProvisioningSecretError(
      "provisioning_secret_decrypt_failed",
      "Provisioning secret failed authenticated decryption",
      false,
    );
  }
}

export async function createProvisioningSecret(
  client: PoolClient,
  input: {
    orgId: string;
    actorId: string;
    jobId: string;
    plaintext: string;
    expiresAt: Date;
  },
): Promise<string> {
  const secretId = randomUUID();
  const envelope = encryptProvisioningSecretValue({
    plaintext: input.plaintext,
    orgId: input.orgId,
    secretId,
    jobId: input.jobId,
  });

  await client.query(
    `INSERT INTO "SecretEntry"
      (id,"orgId",scope,name,"encryptedValue",iv,"authTag","keyVersion","expiresAt","createdById","createdAt","updatedAt")
     VALUES ($1,$2,'SERVICE'::"SecretScope",$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
    [
      secretId,
      input.orgId,
      PREFIX + input.jobId,
      envelope.encryptedValue,
      envelope.iv,
      envelope.authTag,
      envelope.keyVersion,
      input.expiresAt,
      input.actorId,
    ],
  );

  return secretId;
}

export async function readProvisioningSecret(input: {
  secretId: string;
  orgId: string;
  jobId: string;
}): Promise<string> {
  let result;
  try {
    result = await getDb().query<{
      encryptedValue: string;
      iv: string;
      authTag: string;
      keyVersion: number;
      expiresAt: Date | null;
    }>(
      `SELECT "encryptedValue",iv,"authTag","keyVersion","expiresAt"
       FROM "SecretEntry"
       WHERE id=$1
         AND "orgId"=$2
         AND scope='SERVICE'::"SecretScope"
         AND name=$3
       LIMIT 1`,
      [input.secretId, input.orgId, PREFIX + input.jobId],
    );
  } catch {
    throw new ProvisioningSecretError(
      "provisioning_secret_lookup_failed",
      "Provisioning secret lookup failed",
      true,
    );
  }

  const row = result.rows[0];
  if (!row) {
    throw new ProvisioningSecretError(
      "provisioning_secret_not_found",
      "Provisioning secret is unavailable",
      false,
    );
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    await deleteProvisioningSecret(input).catch(() => undefined);
    throw new ProvisioningSecretError(
      "provisioning_secret_expired",
      "Provisioning secret has expired",
      false,
    );
  }

  return decryptProvisioningSecretValue({
    ...row,
    orgId: input.orgId,
    secretId: input.secretId,
    jobId: input.jobId,
  });
}

export async function deleteProvisioningSecret(input: {
  secretId: string;
  orgId: string;
  jobId: string;
}): Promise<boolean> {
  const result = await getDb().query(
    `DELETE FROM "SecretEntry"
     WHERE id=$1
       AND "orgId"=$2
       AND scope='SERVICE'::"SecretScope"
       AND name=$3`,
    [input.secretId, input.orgId, PREFIX + input.jobId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function cleanupExpiredProvisioningSecrets(): Promise<number> {
  const result = await getDb().query(
    `DELETE FROM "SecretEntry"
     WHERE scope='SERVICE'::"SecretScope"
       AND name LIKE $1
       AND "expiresAt" IS NOT NULL
       AND "expiresAt" <= NOW()`,
    [PREFIX + "%"],
  );
  return result.rowCount ?? 0;
}

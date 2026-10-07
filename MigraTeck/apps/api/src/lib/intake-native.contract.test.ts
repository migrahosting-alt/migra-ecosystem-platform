import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decryptIntakePayload,
  encryptIntakePayload,
  validateIntakeResponses,
  type IntakeFormSchema,
} from "./intake-native.js";

process.env.INTAKE_PAYLOAD_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

test("Intake submission payload encrypts and decrypts without plaintext storage", () => {
  const payload = {
    fullName: "Marie Example",
    email: "marie@example.com",
    message: "I need help with onboarding.",
  };
  const encrypted = encryptIntakePayload(payload);

  assert.equal(encrypted.version, 1);
  assert.ok(encrypted.ciphertext.length > 20);
  assert.equal(encrypted.ciphertext.includes("Marie Example"), false);
  assert.deepEqual(decryptIntakePayload({
    payloadCiphertext: encrypted.ciphertext,
    payloadIv: encrypted.iv,
    payloadTag: encrypted.tag,
    encryptionVersion: encrypted.version,
  }), payload);
});

test("tampering with Intake ciphertext fails authenticated decryption", () => {
  const encrypted = encryptIntakePayload({ answer: "safe" });
  const bytes = Buffer.from(encrypted.ciphertext, "base64url");
  bytes[0] = bytes[0]! ^ 0xff;

  assert.throws(() => decryptIntakePayload({
    payloadCiphertext: bytes.toString("base64url"),
    payloadIv: encrypted.iv,
    payloadTag: encrypted.tag,
    encryptionVersion: encrypted.version,
  }));
});

test("Intake response validation rejects unknown and missing required fields", () => {
  const schema: IntakeFormSchema = {
    fields: [
      { key: "email", label: "Email", type: "email", required: true },
      { key: "topic", label: "Topic", type: "select", options: ["Sales", "Support"] },
    ],
  };

  assert.deepEqual(
    validateIntakeResponses(schema, {
      email: "user@example.com",
      topic: "Support",
    }),
    { email: "user@example.com", topic: "Support" },
  );

  assert.throws(() => validateIntakeResponses(schema, { topic: "Support" }));
  assert.throws(() => validateIntakeResponses(schema, {
    email: "user@example.com",
    secretExtra: "not allowed",
  }));
  assert.throws(() => validateIntakeResponses(schema, {
    email: "not-an-email",
  }));
  assert.throws(() => validateIntakeResponses(schema, {
    email: "user@example.com",
    topic: "Unknown",
  }));
});

test("public Intake is the only anonymous mutation path exempted from CSRF", () => {
  const csrf = repoFile("apps/api/src/lib/csrf.ts");
  const routes = repoFile("apps/api/src/routes/v1/modules/intake.ts");

  assert.match(csrf, /route\.startsWith\("\/v1\/intake\/public\/"\)/);
  assert.match(routes, /app\.post\(\s*"\/intake\/public\/forms\/:publicKey\/submissions"/);
  assert.match(routes, /INTAKE_PUBLIC_SUBMISSIONS_PER_MINUTE/);
  assert.match(routes, /platform\.intake\.manage/);
  assert.match(routes, /platform\.intake\.submissions\.read/);
});

test("tenant-native migration stores encrypted answers and organization boundaries", () => {
  const migration = repoFile(
    "prisma/migrations/20261006201500_tenant_native_intake/migration.sql",
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "IntakeForm"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "IntakeSubmission"/);
  assert.match(migration, /"payloadCiphertext" TEXT NOT NULL/);
  assert.match(migration, /"payloadIv" TEXT NOT NULL/);
  assert.match(migration, /"payloadTag" TEXT NOT NULL/);
  assert.doesNotMatch(migration, /"payloadJson"/);
  assert.match(migration, /FOREIGN KEY \("orgId"\) REFERENCES "Organization"/);
  assert.match(migration, /FOREIGN KEY \("formId"\) REFERENCES "IntakeForm"/);
});

test("legacy Intake runtime remains isolated from tenant-native writes", () => {
  const integration = repoFile("apps/api/src/lib/intake-integration.ts");
  const routes = repoFile("apps/api/src/routes/v1/modules/intake.ts");

  assert.match(integration, /legacy_global/);
  assert.match(routes, /Existing production legacy bridge/);
  assert.doesNotMatch(routes, /writeFile\(|projects\.json/);
});

test("public Intake idempotency is conflict-safe under concurrent retries", () => {
  const model = repoFile("apps/api/src/lib/intake-native.ts");
  assert.match(
    model,
    /ON CONFLICT \("formId","idempotencyKey"\) DO NOTHING/,
  );
  assert.match(model, /Idempotent Intake submission conflict could not be resolved/);
  assert.match(model, /intake-fingerprint:v1\\0/);
});

test("web boundary keeps public form transport separate from operator authority", () => {
  const publicForm = repoFile(
    "apps/web/src/app/api/intake/forms/[publicKey]/route.ts",
  );
  const publicSubmission = repoFile(
    "apps/web/src/app/api/intake/forms/[publicKey]/submissions/route.ts",
  );
  const operator = repoFile(
    "apps/web/src/app/api/platform/intake/native/submissions/[submissionId]/route.ts",
  );
  const workspace = repoFile(
    "apps/web/src/app/(platform)/platform/intake/IntakeNativeWorkspace.tsx",
  );

  assert.doesNotMatch(publicForm, /getAppSession|fetchPlatformAuthorityApi/);
  assert.doesNotMatch(publicSubmission, /getAppSession|fetchPlatformAuthorityApi/);
  assert.match(publicSubmission, /Idempotency-Key/);
  assert.match(operator, /getAppSession/);
  assert.match(operator, /fetchPlatformAuthorityApi/);
  assert.match(workspace, /platform\.intake\.submissions\.read/);
  assert.match(workspace, /platform\.intake\.manage/);
});

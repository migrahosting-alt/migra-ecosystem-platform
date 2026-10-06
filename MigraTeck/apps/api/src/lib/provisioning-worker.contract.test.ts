import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalizeJson,
  hashCanonicalPayload,
  signProvisioningEnvelope,
  verifyProvisioningEnvelope,
} from "./provisioning-crypto.js";
import {
  executeProvisioningJob,
  type ProvisioningJobRecord,
} from "./provisioning-provider.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

function job(payload: Record<string, unknown>): ProvisioningJobRecord {
  const createdAt = new Date("2026-10-06T00:00:00.000Z");
  return {
    id: "job_contract_1",
    orgId: "org_contract_1",
    createdByActorId: null,
    source: "MANUAL",
    type: "PROVISION",
    status: "RUNNING",
    attempts: 1,
    maxAttempts: 5,
    notBefore: null,
    lastError: null,
    lastErrorAt: null,
    lockedAt: createdAt,
    lockedBy: "contract-worker",
    startedAt: createdAt,
    finishedAt: null,
    idempotencyKey: "contract-key",
    envelopeVersion: 1,
    payload,
    payloadHash: hashCanonicalPayload(payload),
    signature: "",
    expiresAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

test("canonical provisioning payloads sort object keys recursively", () => {
  assert.equal(
    canonicalizeJson({ z: 1, a: { y: 2, x: 3 }, list: [{ b: 1, a: 2 }] }),
    '{"a":{"x":3,"y":2},"list":[{"a":2,"b":1}],"z":1}',
  );
});

test("provisioning envelope signature matches the legacy wire format", () => {
  const previous = process.env.JOB_ENVELOPE_SIGNING_SECRET;
  process.env.JOB_ENVELOPE_SIGNING_SECRET = "contract-signing-secret";
  try {
    const input = {
      jobId: "job-1",
      orgId: "org-1",
      type: "PROVISION",
      payloadHash: "abc123",
      createdAt: "2026-10-06T00:00:00.000Z",
      expiresAt: null,
      envelopeVersion: 1,
    };
    const expected = createHmac("sha256", "contract-signing-secret")
      .update(
        "v=1|jobId=job-1|orgId=org-1|type=PROVISION|payloadHash=abc123|createdAt=2026-10-06T00:00:00.000Z|expiresAt=",
      )
      .digest("hex");

    const signature = signProvisioningEnvelope(input);
    assert.equal(signature, expected);
    assert.equal(verifyProvisioningEnvelope({ ...input, signature }), true);
    const tampered = (signature[0] === "0" ? "1" : "0") + signature.slice(1);
    assert.equal(
      verifyProvisioningEnvelope({ ...input, signature: tampered }),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.JOB_ENVELOPE_SIGNING_SECRET;
    else process.env.JOB_ENVELOPE_SIGNING_SECRET = previous;
  }
});

test("unconfigured generic product dispatch fails closed", async () => {
  const keys = [
    "MIGRAVOICE_PROVISION_URL",
    "MIGRAVOICE_PROVISION_TOKEN",
    "PROVISIONING_DISPATCH_URL",
    "PROVISIONING_DISPATCH_TOKEN",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  try {
    const result = await executeProvisioningJob(
      job({
        productLane: "MIGRAVOICE",
        product: "MIGRAVOICE",
        action: "VOICE_PROVISION",
      }),
      "contract-worker",
    );
    assert.equal(result.kind, "FATAL_FAILURE");
    assert.equal(
      (result as { message?: string }).message,
      "missing_dispatch_target",
    );
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("configured hosting agent still requires complete service context before network dispatch", async () => {
  const keys = [
    "MIGRAHOSTING_AGENT_URL",
    "MIGRAHOSTING_AGENT_KEY_ID",
    "MIGRAHOSTING_AGENT_SECRET",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.MIGRAHOSTING_AGENT_URL = "http://127.0.0.1:1";
  process.env.MIGRAHOSTING_AGENT_KEY_ID = "contract-key";
  process.env.MIGRAHOSTING_AGENT_SECRET = "contract-secret";

  try {
    const result = await executeProvisioningJob(
      job({
        productLane: "MIGRAHOSTING",
        product: "MIGRAHOSTING",
        action: "POD_CREATE",
      }),
      "contract-worker",
    );
    assert.equal(result.kind, "FATAL_FAILURE");
    assert.equal(
      (result as { message?: string }).message,
      "missing_hosting_context",
    );
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("queue engine uses atomic claims, stale-lock recovery, and payload tamper detection", () => {
  const engine = repoFile("apps/api/src/lib/provisioning-engine.ts");
  assert.match(engine, /FOR UPDATE SKIP LOCKED/);
  assert.match(engine, /stale_lock_recovered/);
  assert.match(engine, /payload_hash_mismatch/);
  assert.match(engine, /verifyProvisioningEnvelope/);
  assert.match(engine, /PROVISIONING_JOB_RETRY_SCHEDULED/);
  assert.match(engine, /publishPlatformEvent/);
  assert.match(engine, /provisioning\.job_failed/);
  assert.match(engine, /provisioning\.job_dead/);
  assert.match(engine, /reason_code: publicFailureCode/);
  assert.match(
    engine,
    /\^\[a-z0-9\]\[a-z0-9\._-\]\{0,79\}\$/,
    "public webhook failure codes must reject arbitrary internal error text",
  );
});

test("worker closes its database pool on graceful stop and exposes runtime readiness", () => {
  const worker = repoFile("apps/api/src/provisioning-worker.ts");
  const unit = repoFile("deploy/migrateck-provisioning-worker.service");
  assert.match(worker, /SIGTERM/);
  assert.match(worker, /SIGINT/);
  assert.match(worker, /await closeDb\(\)/);
  assert.match(worker, /heartbeat\.json/);
  assert.match(worker, /await writeHeartbeat\(id\)/);
  assert.match(worker, /await removeHeartbeat\(\)/);
  assert.match(unit, /RuntimeDirectory=migrateck-provisioning/);
});

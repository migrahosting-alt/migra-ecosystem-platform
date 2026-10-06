import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBHOOK_EVENT_CATALOG,
  decryptWebhookSecret,
  encryptWebhookSecret,
  isPrivateAddress,
  signWebhookPayload,
  validateWebhookUrl,
} from "./webhooks.js";

process.env.WEBHOOK_SECRET_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("webhook signing secret encrypts and decrypts without plaintext storage", () => {
  const secret = "whsec_test_secret_value";
  const encrypted = encryptWebhookSecret(secret);

  assert.notEqual(encrypted, secret);
  assert.ok(encrypted.startsWith("enc:v1:"));
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptWebhookSecret(encrypted), secret);
});

test("tampering with encrypted webhook secret fails authentication", () => {
  const encrypted = encryptWebhookSecret("whsec_tamper_test");
  const parts = encrypted.split(":");
  const ciphertext = Buffer.from(parts[4]!, "base64url");
  ciphertext[0] = ciphertext[0]! ^ 0xff;
  parts[4] = ciphertext.toString("base64url");

  assert.throws(() => decryptWebhookSecret(parts.join(":")));
});

test("plaintext webhook secrets are refused instead of treated as legacy data", () => {
  assert.throws(() => decryptWebhookSecret("whsec_plaintext_should_not_be_accepted"));
});

test("webhook HMAC signature is deterministic and binds timestamp", () => {
  const payload = JSON.stringify({ event: "incident.created", id: "evt_1" });
  const first = signWebhookPayload("secret", payload, 1700000000);
  const second = signWebhookPayload("secret", payload, 1700000000);
  const differentTimestamp = signWebhookPayload("secret", payload, 1700000001);

  assert.equal(first, second);
  assert.notEqual(first, differentTimestamp);
});

test("webhook URL policy requires HTTPS and rejects embedded credentials", () => {
  assert.equal(validateWebhookUrl("https://example.com/hooks").protocol, "https:");
  assert.throws(() => validateWebhookUrl("http://example.com/hooks"));
  assert.throws(() => validateWebhookUrl("https://user:pass@example.com/hooks"));
});

test("private, loopback, link-local, CGNAT and private IPv6 targets are rejected", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }

  assert.equal(isPrivateAddress("1.1.1.1"), false);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
  assert.throws(() => validateWebhookUrl("https://127.0.0.1/hook"));
  assert.throws(() => validateWebhookUrl("https://localhost/hook"));
  assert.throws(() => validateWebhookUrl("https://service.internal/hook"));
});

test("only active Platform API producers are marked live in the webhook catalog", () => {
  const live = WEBHOOK_EVENT_CATALOG
    .filter((entry) => entry.readiness === "live")
    .map((entry) => entry.event)
    .sort();

  assert.deepEqual(live, [
    "api_key.created",
    "api_key.revoked",
    "entitlement.granted",
    "entitlement.revoked",
    "provisioning.job_dead",
    "provisioning.job_failed",
    "webhook.endpoint_disabled",
  ]);
  assert.equal(
    WEBHOOK_EVENT_CATALOG.find((entry) => entry.event === "incident.created")?.readiness,
    "contract",
  );
  assert.equal(
    WEBHOOK_EVENT_CATALOG.find((entry) => entry.event === "billing.payment_failed")?.readiness,
    "contract",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_STRIPE_WEBHOOK_API_VERSION,
  CANONICAL_STRIPE_WEBHOOK_EVENTS,
  CANONICAL_STRIPE_WEBHOOK_URL,
} from "./commerce-billing-readiness.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile("apps/api/src/lib/commerce-billing-readiness.ts");
const routes = repoFile(
  "apps/api/src/routes/v1/modules/commerce-billing-readiness.ts",
);
const registry = repoFile("apps/api/src/routes/v1/index.ts");

test("canonical Stripe webhook contract is explicit and complete", () => {
  assert.equal(
    CANONICAL_STRIPE_WEBHOOK_URL,
    "https://migrateck.com/v1/billing/webhooks/stripe",
  );
  assert.equal(CANONICAL_STRIPE_WEBHOOK_API_VERSION, "2025-07-30.basil");
  assert.equal(CANONICAL_STRIPE_WEBHOOK_EVENTS.length, 21);
  for (const event of [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.created",
    "invoice.updated",
    "invoice.finalized",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
    "invoice.marked_uncollectible",
  ]) {
    assert.ok(CANONICAL_STRIPE_WEBHOOK_EVENTS.includes(event as never));
  }
});

test("billing readiness is read-only and platform commerce scoped", () => {
  assert.match(
    routes,
    /app\.get\("\/commerce\/billing-readiness"[\s\S]*?platform\.commerce\.read/,
  );
  assert.doesNotMatch(
    routes,
    /app\.(post|patch|put|delete)\("\/commerce\/billing-readiness/,
  );
  assert.match(registry, /registerCommerceBillingReadinessRoutes/);
});

test("readiness checks endpoint identity, URL, status and required event coverage", () => {
  assert.match(service, /STRIPE_CANONICAL_WEBHOOK_ENDPOINT_ID/);
  assert.match(service, /STRIPE_CANONICAL_WEBHOOK_URL/);
  assert.match(service, /webhookEndpoints\.retrieve/);
  assert.match(service, /endpoint_event_gap/);
  assert.match(service, /endpoint_url_drift/);
  assert.match(service, /endpoint_disabled/);
  assert.match(service, /endpoint_api_version_drift/);
});

test("readiness detects processor deliveries missing from the canonical ledger", () => {
  assert.match(service, /stripe\.events\.list\(\{ limit: 100 \}\)/);
  assert.match(service, /relevantEventsSinceEndpointCreation/);
  assert.match(service, /missingLocalDeliveries/);
  assert.match(service, /processor_delivery_gap/);
  assert.match(service, /"eventId"=ANY\(\$1::text\[\]\)/);
});

test("readiness covers reconciliation and webhook ledger failure modes", () => {
  assert.match(service, /mapped_customer_never_reconciled/);
  assert.match(service, /failed_webhook_events/);
  assert.match(service, /stalled_webhook_events/);
  assert.match(service, /unmapped_stripe_customer_events/);
  assert.match(service, /projection_gap/);
});

test("readiness never returns Stripe secrets or customer identifiers", () => {
  assert.match(service, /processorSecretConfigured/);
  assert.match(service, /webhookSecretConfigured/);
  assert.doesNotMatch(service, /externalCustomerId/);
  assert.doesNotMatch(service, /return[\s\S]{0,200}STRIPE_SECRET_KEY/);
  assert.doesNotMatch(service, /return[\s\S]{0,200}STRIPE_WEBHOOK_SECRET/);
});

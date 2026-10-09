import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REVENUE_EXCEPTION_KINDS } from "./commerce-revenue-exceptions.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile("apps/api/src/lib/commerce-revenue-exceptions.ts");
const routes = repoFile(
  "apps/api/src/routes/v1/modules/commerce-revenue-exceptions.ts",
);
const registry = repoFile("apps/api/src/routes/v1/index.ts");

test("revenue exception vocabulary is closed and operational", () => {
  assert.deepEqual(REVENUE_EXCEPTION_KINDS, [
    "subscription_payment_risk",
    "invoice_open_balance",
    "invoice_uncollectible",
    "stripe_webhook_failed",
    "stripe_webhook_stalled",
    "billing_identity_missing",
    "billing_identity_mismatch",
  ]);
});

test("revenue exceptions are read-only and commerce-authority scoped", () => {
  assert.match(
    routes,
    /app\.get\("\/commerce\/revenue-exceptions"[\s\S]*?platform\.commerce\.read/,
  );
  assert.doesNotMatch(
    routes,
    /app\.(post|patch|put|delete)\("\/commerce\/revenue-exceptions/,
  );
  assert.match(registry, /registerCommerceRevenueExceptionRoutes/);
});

test("revenue exception projection excludes raw payment and webhook payload material", () => {
  assert.doesNotMatch(service, /payloadJson/);
  assert.doesNotMatch(service, /hostedInvoiceUrl/);
  assert.doesNotMatch(service, /invoicePdfUrl/);
  assert.doesNotMatch(service, /paymentMethod/);
  assert.doesNotMatch(service, /errorText/);
  assert.match(service, /jsonb_build_object/);
});

test("revenue exception detection covers processor, receivable and identity drift", () => {
  assert.match(service, /PAST_DUE/);
  assert.match(service, /UNPAID/);
  assert.match(service, /INCOMPLETE_EXPIRED/);
  assert.match(service, /lower\(i\.status\)='open'/);
  assert.match(service, /lower\(i\.status\)='uncollectible'/);
  assert.match(service, /e\.status::text='FAILED'/);
  assert.match(service, /INTERVAL '10 minutes'/);
  assert.match(service, /billing_identity_missing/);
  assert.match(service, /billing_identity_mismatch/);
});

test("revenue exception query is bounded, filterable and deterministically ordered", () => {
  assert.match(service, /Math\.min\(100, Math\.max\(1/);
  assert.match(service, /Math\.min\(1_000_000, Math\.max\(0/);
  assert.match(service, /kind=/);
  assert.match(service, /severity=/);
  assert.match(service, /ILIKE/);
  assert.match(
    service,
    /ORDER BY "occurredAt" DESC NULLS LAST,kind,"entityId"/,
  );
});

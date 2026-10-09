import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REVENUE_ANALYTICS_WINDOWS } from "./commerce-revenue-analytics.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile("apps/api/src/lib/commerce-revenue-analytics.ts");
const routes = repoFile(
  "apps/api/src/routes/v1/modules/commerce-revenue-analytics.ts",
);
const registry = repoFile("apps/api/src/routes/v1/index.ts");

test("revenue analytics windows are bounded and explicit", () => {
  assert.deepEqual(REVENUE_ANALYTICS_WINDOWS, [30, 90, 180, 365]);
  assert.match(routes, /windowDays/);
  assert.match(routes, /default\(180\)/);
});

test("revenue analytics are read-only and commerce-authority scoped", () => {
  assert.match(
    routes,
    /app\.get\("\/commerce\/revenue-analytics"[\s\S]*?platform\.commerce\.read/,
  );
  assert.doesNotMatch(
    routes,
    /app\.(post|patch|put|delete)\("\/commerce\/revenue-analytics/,
  );
  assert.match(registry, /registerCommerceRevenueAnalyticsRoutes/);
});

test("revenue analytics preserve accounting truth and currency boundaries", () => {
  assert.match(service, /operational_invoice_evidence/);
  assert.match(service, /revenueRecognition:\s*false/);
  assert.match(
    service,
    /GROUP BY lower\(COALESCE\(NULLIF\(currency,''\),'unknown'\)\)/,
  );
  assert.match(service, /finalizedAmount/);
  assert.match(service, /amountPaid/);
  assert.match(service, /openAmount/);
  assert.match(service, /uncollectibleAmount/);
  assert.doesNotMatch(service, /MRR|ARR|recognizedRevenue|netRevenue/i);
});

test("receivable aging is explicit about its evidence basis", () => {
  assert.match(service, /invoice_finalized_at/);
  assert.match(service, /dueDateAvailable:\s*false/);
  assert.match(service, /30 days/);
  assert.match(service, /60 days/);
  assert.match(service, /90 days/);
  assert.match(service, /unfinalized/);
  assert.match(service, /91_plus/);
});

test("analytics distinguish empty, identity-only and observed billing states", () => {
  assert.match(service, /"observed"/);
  assert.match(service, /"identity_only"/);
  assert.match(service, /"empty"/);
  assert.match(service, /customerCount/);
  assert.match(service, /invoiceCount/);
  assert.match(service, /subscriptionCount/);
  assert.match(service, /webhookEventCount/);
});

test("processor health uses canonical webhook evidence without exposing payloads", () => {
  assert.match(service, /FAILED/);
  assert.match(service, /RECEIVED/);
  assert.match(service, /QUEUED/);
  assert.match(service, /PROCESSING/);
  assert.match(service, /INTERVAL '10 minutes'/);
  assert.match(service, /receivedLast24h/);
  assert.match(service, /failedLast24h/);
  assert.match(service, /processedLast24h/);
  assert.doesNotMatch(service, /payloadJson/);
  assert.doesNotMatch(service, /errorText/);
});

test("invoice trend is time-bounded and returns no synthetic rows", () => {
  assert.match(service, /make_interval\(days => \$1\)/);
  assert.match(service, /trendResult\.rows\.map/);
  assert.doesNotMatch(service, /generate_series/);
});

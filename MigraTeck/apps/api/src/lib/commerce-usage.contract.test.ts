import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCatalogMeterDefinitions,
  USAGE_METRICS,
} from "./commerce-usage.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

test("canonical meter registry is derived from source catalog and contains known meter names", () => {
  const meters = getCatalogMeterDefinitions();
  const names = new Set(meters.map((meter) => meter.meterName));

  for (const expected of [
    "ai_generations",
    "bandwidth_gb",
    "email_sends",
    "marketing_contacts",
    "pilot_runs",
    "storage_gb",
  ]) {
    assert.ok(names.has(expected), "missing catalog meter " + expected);
  }

  for (const meter of meters) {
    assert.ok(meter.lookupKey.length > 0);
    assert.ok(meter.product.startsWith("MIGRA"));
    assert.ok(USAGE_METRICS.includes(meter.metric));
  }
});

test("usage ledger migration is additive and preserves existing API telemetry", () => {
  const migration = repoFile(
    "prisma/migrations/20261006033000_commerce_usage_ledger/migration.sql",
  );

  assert.match(migration, /ALTER TABLE "UsageEvent"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "meterName"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "idempotencyKey"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "exportStatus"/);
  assert.match(migration, /DEFAULT 'LOCAL_ONLY'/);
  assert.match(migration, /UsageEvent_idempotencyKey_key/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|RENAME COLUMN/i);
});

test("machine usage ingestion is API-key scoped, catalog checked, idempotent and quota-accounted", () => {
  const routes = repoFile("apps/api/src/routes/v1/modules/commerce-usage.ts");
  const service = repoFile("apps/api/src/lib/commerce-usage.ts");

  assert.match(routes, /requireApiKeyScope\(request, "usage:write"\)/);
  assert.match(routes, /requireApiKeyScope\(request, "usage:read"\)/);
  assert.match(service, /meterCandidates\(input\.product, input\.meterName\)/);
  assert.match(service, /ON CONFLICT \("idempotencyKey"\) DO NOTHING/);
  assert.match(service, /Idempotency key is already bound to a different usage event/);
  assert.match(service, /UPDATE "UsageQuota"/);
  assert.match(service, /"currentUsed"="currentUsed"\+\$1::bigint/);
  assert.match(service, /PENDING_EXPORT/);
});

test("API request telemetry remains local-only by relying on ledger defaults", () => {
  const apiUsage = repoFile("apps/api/src/lib/api-usage.ts");
  const migration = repoFile(
    "prisma/migrations/20261006033000_commerce_usage_ledger/migration.sql",
  );

  assert.doesNotMatch(apiUsage, /"meterName"/);
  assert.doesNotMatch(apiUsage, /"exportStatus"/);
  assert.match(migration, /"exportStatus" TEXT NOT NULL DEFAULT 'LOCAL_ONLY'/);
});

test("usage exporter claims atomically and sends canonical Stripe meter events", () => {
  const engine = repoFile("apps/api/src/lib/usage-export-engine.ts");

  assert.match(engine, /FOR UPDATE SKIP LOCKED/);
  assert.match(engine, /"exportStatus"='RUNNING'/);
  assert.match(engine, /"externalCustomerId"/);
  assert.match(engine, /provider='STRIPE'::"BillingProvider"/);
  assert.match(engine, /stripe\.billing\.meterEvents\.create/);
  assert.match(engine, /identifier: "migrateck_usage_" \+ event\.id/);
  assert.match(engine, /idempotencyKey: "migrateck_usage_" \+ event\.id/);
});

test("usage exporter is bounded, recoverable and opens reconciliation evidence on terminal failure", () => {
  const engine = repoFile("apps/api/src/lib/usage-export-engine.ts");

  assert.match(engine, /MAX_EXPORT_ATTEMPTS = 6/);
  assert.match(engine, /recoverStaleUsageExports/);
  assert.match(engine, /"exportStatus"='RETRY'/);
  assert.match(engine, /"exportStatus"='FAILED'/);
  assert.match(engine, /USAGE_EXPORT_FAILURE/);
  assert.match(engine, /ReconciliationReport/);
});

test("operator usage mutations require narrow commerce usage authority", () => {
  const routes = repoFile("apps/api/src/routes/v1/modules/commerce-usage.ts");

  assert.match(routes, /"platform\.commerce\.read"/);
  const usageManageMatches =
    routes.match(/"platform\.commerce\.usage\.manage"/g) ?? [];
  assert.ok(usageManageMatches.length >= 3);
  assert.doesNotMatch(routes, /requireOrganizationPrincipal/);
});

test("usage worker is managed, heartbeat-driven and closes DB on graceful stop", () => {
  const worker = repoFile("apps/api/src/usage-worker.ts");
  const unit = repoFile("deploy/migrateck-usage-worker.service");

  assert.match(worker, /SIGTERM/);
  assert.match(worker, /SIGINT/);
  assert.match(worker, /heartbeat\.json/);
  assert.match(worker, /await closeDb\(\)/);
  assert.match(worker, /recoverStaleUsageExports/);
  assert.match(unit, /RuntimeDirectory=migrateck-usage/);
  assert.match(unit, /dist\/usage-worker\.js/);
});

test("canonical usage pricing is not auto-provisionable while processor rates are undefined", () => {
  const meters = getCatalogMeterDefinitions();
  assert.equal(meters.length, 8);
  assert.equal(new Set(meters.map((meter) => meter.meterName)).size, 7);
  assert.ok(meters.some((meter) => meter.meterName === "voice_minutes"));
  assert.ok(meters.every((meter) => meter.unitAmount === null));

  const engine = repoFile("apps/api/src/lib/usage-export-engine.ts");
  assert.match(engine, /inspectUsageProcessorTopology/);
  assert.match(engine, /stripe\.billing\.meters\.list/);
  assert.match(engine, /stripe\.prices\.list/);
  assert.match(engine, /price\.recurring\.meter !== meter\.id/);
  assert.match(engine, /price\.recurring\.usage_type !== "metered"/);
  assert.match(engine, /meter\.default_aggregation\.formula !== "sum"/);
  assert.match(engine, /stripe_customer_id/);
  assert.match(engine, /event_payload_key !== "value"/);
  assert.doesNotMatch(engine, /billing\.meters\.create/);
  assert.doesNotMatch(engine, /prices\.create/);
});

test("billable ingestion and operator retry fail closed before ledger mutation when processor is unavailable", () => {
  const service = repoFile("apps/api/src/lib/commerce-usage.ts");
  const routes = repoFile("apps/api/src/routes/v1/modules/commerce-usage.ts");

  const ingest = service.slice(
    service.indexOf("export async function recordMachineUsage"),
    service.indexOf("async function usageWorkerReadiness"),
  );
  assert.ok(ingest.indexOf("await requireUsageProcessorReady()") >= 0);
  assert.ok(
    ingest.indexOf("await requireUsageProcessorReady()") <
      ingest.indexOf('INSERT INTO "UsageEvent"'),
  );
  assert.match(service, /Usage processor provisioning is incomplete/);
  assert.match(service, /Usage export worker is unavailable/);

  const retry = service.slice(
    service.indexOf("export async function retryUsageExport"),
    service.indexOf("export function assertUsageProduct"),
  );
  assert.ok(retry.indexOf("await requireUsageProcessorReady()") >= 0);
  assert.ok(
    retry.indexOf("await requireUsageProcessorReady()") <
      retry.indexOf('UPDATE "UsageEvent"'),
  );
  assert.match(retry, /reason: input\.reason/);
  assert.match(routes, /usageRetryBodySchema/);
  assert.match(routes, /reason: z\.string\(\)\.trim\(\)\.min\(3\)\.max\(500\)/);
});

test("usage worker publishes processor readiness and never burns export attempts while topology is blocked", () => {
  const worker = repoFile("apps/api/src/usage-worker.ts");

  assert.match(worker, /inspectUsageProcessorTopology/);
  assert.match(worker, /processorCheckIntervalMs/);
  assert.match(worker, /processor,/);
  assert.match(
    worker,
    /const processed = processor\.ready\s*\? await processUsageExportBatch\(batchSize\(\)\)\s*:\s*0/,
  );
});

test("usage operator distinguishes worker liveness from processor provisioning and disables unsafe retry", () => {
  const ui = repoFile(
    "apps/web/src/app/(platform)/platform/commerce/usage/CommerceUsageWorkspace.tsx",
  );

  assert.match(ui, /Stripe usage processor is not provisioned/);
  assert.match(ui, /Billable usage ingestion and manual export retry are fail-closed/);
  assert.match(ui, /Meters \{data\.processor\.meters\.present\}/);
  assert.match(ui, /Prices \{data\.processor\.prices\.present\}/);
  assert.match(ui, /Automatic processor creation is intentionally disabled/);
  assert.match(ui, /No organization has reported billable usage yet/);
  assert.match(ui, /data\.processor\.ready \? \(/);
  assert.match(ui, /Processor blocked/);
  assert.match(ui, /Reason for retrying this usage export/);
  assert.match(ui, /JSON\.stringify\(\{ reason: reason\.trim\(\) \}\)/);
  assert.doesNotMatch(ui, /Create Stripe meter/i);
  assert.doesNotMatch(ui, /Create Stripe price/i);
});

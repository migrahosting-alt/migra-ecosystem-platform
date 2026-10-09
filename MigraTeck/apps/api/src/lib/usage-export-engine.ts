import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getDb } from "./db.js";
import { getCatalogMeterDefinitions } from "./commerce-usage.js";

const MAX_EXPORT_ATTEMPTS = 6;
const EXPORT_LEASE_MS = 120_000;
const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export type UsageProcessorReadiness = {
  ready: boolean;
  checkedAt: string | null;
  reason: string | null;
  meters: {
    required: number;
    present: number;
    missingNames: string[];
    misconfiguredNames: string[];
  };
  prices: {
    required: number;
    present: number;
    missingLookupKeys: string[];
    mismatchedMeterLookupKeys: string[];
    nonMeteredLookupKeys: string[];
  };
  autoProvisioning: {
    ready: boolean;
    missingRateLookupKeys: string[];
    reason: string | null;
  };
};

export type UsageExportRecord = {
  id: string;
  orgId: string;
  product: string;
  metric: string;
  quantity: string;
  meterName: string;
  exportStatus: string;
  exportAttempts: number;
  nextRetryAt: Date | null;
  timestamp: Date;
};

function stripeClient(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is required for usage export");
  }

  return new Stripe(secret, {
    apiVersion: "2025-04-30.basil" as Stripe.LatestApiVersion,
    typescript: true,
  });
}

export async function inspectUsageProcessorTopology(): Promise<UsageProcessorReadiness> {
  const definitions = getCatalogMeterDefinitions();
  const requiredMeterNames = [...new Set(definitions.map((definition) => definition.meterName))].sort();
  const requiredLookupKeys = [...new Set(definitions.map((definition) => definition.lookupKey))].sort();
  const missingRateLookupKeys = definitions
    .filter((definition) => definition.unitAmount === null)
    .map((definition) => definition.lookupKey)
    .sort();
  const checkedAt = new Date().toISOString();

  try {
    const stripe = stripeClient();
    const activeMeters: Stripe.Billing.Meter[] = [];
    for await (const meter of stripe.billing.meters.list({
      limit: 100,
      status: "active",
    })) {
      if (requiredMeterNames.includes(meter.event_name)) activeMeters.push(meter);
    }

    const meterByName = new Map(activeMeters.map((meter) => [meter.event_name, meter]));
    const missingNames = requiredMeterNames.filter((name) => !meterByName.has(name));
    const misconfiguredNames = requiredMeterNames.filter((name) => {
      const meter = meterByName.get(name);
      if (!meter) return false;
      return (
        meter.default_aggregation.formula !== "sum" ||
        meter.customer_mapping?.type !== "by_id" ||
        meter.customer_mapping?.event_payload_key !== "stripe_customer_id" ||
        meter.value_settings?.event_payload_key !== "value"
      );
    });

    const pricePage = requiredLookupKeys.length
      ? await stripe.prices.list({
          active: true,
          lookup_keys: requiredLookupKeys,
          limit: Math.min(Math.max(requiredLookupKeys.length, 1), 100),
        })
      : { data: [] as Stripe.Price[] };
    const priceByLookupKey = new Map(
      pricePage.data
        .filter((price) => Boolean(price.lookup_key))
        .map((price) => [price.lookup_key as string, price]),
    );
    const missingLookupKeys = requiredLookupKeys.filter(
      (lookupKey) => !priceByLookupKey.has(lookupKey),
    );
    const mismatchedMeterLookupKeys: string[] = [];
    const nonMeteredLookupKeys: string[] = [];

    for (const definition of definitions) {
      const price = priceByLookupKey.get(definition.lookupKey);
      if (!price) continue;
      const meter = meterByName.get(definition.meterName);
      if (!price.recurring || price.recurring.usage_type !== "metered") {
        nonMeteredLookupKeys.push(definition.lookupKey);
        continue;
      }
      if (!meter || price.recurring.meter !== meter.id) {
        mismatchedMeterLookupKeys.push(definition.lookupKey);
      }
    }

    const ready =
      missingNames.length === 0 &&
      misconfiguredNames.length === 0 &&
      missingLookupKeys.length === 0 &&
      mismatchedMeterLookupKeys.length === 0 &&
      nonMeteredLookupKeys.length === 0;

    return {
      ready,
      checkedAt,
      reason: ready
        ? null
        : "Stripe usage processor topology is incomplete or inconsistent with the canonical catalog",
      meters: {
        required: requiredMeterNames.length,
        present: requiredMeterNames.length - missingNames.length,
        missingNames,
        misconfiguredNames,
      },
      prices: {
        required: requiredLookupKeys.length,
        present: requiredLookupKeys.length - missingLookupKeys.length,
        missingLookupKeys,
        mismatchedMeterLookupKeys: [...new Set(mismatchedMeterLookupKeys)].sort(),
        nonMeteredLookupKeys: [...new Set(nonMeteredLookupKeys)].sort(),
      },
      autoProvisioning: {
        ready: missingRateLookupKeys.length === 0,
        missingRateLookupKeys,
        reason:
          missingRateLookupKeys.length === 0
            ? null
            : "Canonical usage price rates are not defined; automatic Stripe price creation is disabled",
      },
    };
  } catch (error) {
    return {
      ready: false,
      checkedAt,
      reason: "Stripe usage processor inspection is unavailable",
      meters: {
        required: requiredMeterNames.length,
        present: 0,
        missingNames: requiredMeterNames,
        misconfiguredNames: [],
      },
      prices: {
        required: requiredLookupKeys.length,
        present: 0,
        missingLookupKeys: requiredLookupKeys,
        mismatchedMeterLookupKeys: [],
        nonMeteredLookupKeys: [],
      },
      autoProvisioning: {
        ready: missingRateLookupKeys.length === 0,
        missingRateLookupKeys,
        reason:
          missingRateLookupKeys.length === 0
            ? null
            : "Canonical usage price rates are not defined; automatic Stripe price creation is disabled",
      },
    };
  }
}

function retryDelay(attempts: number): number {
  return (
    RETRY_DELAYS_MS[
      Math.min(
        Math.max(attempts - 1, 0),
        RETRY_DELAYS_MS.length - 1,
      )
    ] ?? RETRY_DELAYS_MS.at(-1)!
  );
}

function stripeStatusCode(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return null;
}

function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1800);
  return String(error).slice(0, 1800);
}

function isPermanentFailure(error: unknown): boolean {
  const status = stripeStatusCode(error);
  if (status === null) return false;
  if (status === 408 || status === 409 || status === 429) return false;
  return status >= 400 && status < 500;
}

async function claimUsageExports(batchSize: number): Promise<UsageExportRecord[]> {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<UsageExportRecord>(
      `WITH candidates AS (
         SELECT id
         FROM "UsageEvent"
         WHERE "meterName" IS NOT NULL
           AND "exportAttempts"<$2
           AND (
             (
               "exportStatus" IN ('PENDING_EXPORT','RETRY')
               AND ("nextRetryAt" IS NULL OR "nextRetryAt"<=NOW())
             )
             OR (
               "exportStatus"='RUNNING'
               AND "nextRetryAt"<=NOW()
             )
           )
         ORDER BY COALESCE("nextRetryAt",timestamp) ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE "UsageEvent" e
       SET
         "exportStatus"='RUNNING',
         "exportAttempts"=e."exportAttempts"+1,
         "nextRetryAt"=NOW()+($3::text || ' milliseconds')::interval,
         "updatedAt"=NOW()
       FROM candidates c
       WHERE e.id=c.id
       RETURNING
         e.id,
         e."orgId",
         e.product::text AS product,
         e.metric::text AS metric,
         e.quantity::text AS quantity,
         e."meterName",
         e."exportStatus",
         e."exportAttempts",
         e."nextRetryAt",
         e.timestamp`,
      [Math.min(Math.max(batchSize, 1), 100), MAX_EXPORT_ATTEMPTS, EXPORT_LEASE_MS],
    );

    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function billingCustomerId(orgId: string): Promise<string | null> {
  const result = await getDb().query<{ externalCustomerId: string }>(
    `SELECT "externalCustomerId"
     FROM "BillingCustomer"
     WHERE "orgId"=$1
       AND provider='STRIPE'::"BillingProvider"
     LIMIT 1`,
    [orgId],
  );
  return result.rows[0]?.externalCustomerId ?? null;
}

function meterIsCanonical(event: UsageExportRecord): boolean {
  return getCatalogMeterDefinitions().some(
    (definition) =>
      definition.product === event.product &&
      definition.meterName === event.meterName,
  );
}

async function resolveOpenFailure(eventId: string): Promise<void> {
  await getDb().query(
    `UPDATE "ReconciliationReport"
     SET status='RESOLVED',"resolvedAt"=NOW(),"updatedAt"=NOW()
     WHERE type='USAGE_EXPORT_FAILURE'
       AND status='OPEN'
       AND metadata->>'eventId'=$1`,
    [eventId],
  );
}

async function markExported(event: UsageExportRecord): Promise<void> {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE "UsageEvent"
       SET
         "exportStatus"='EXPORTED',
         "nextRetryAt"=NULL,
         "exportedAt"=NOW(),
         "exportError"=NULL,
         "updatedAt"=NOW()
       WHERE id=$1`,
      [event.id],
    );

    await client.query(
      `UPDATE "ReconciliationReport"
       SET status='RESOLVED',"resolvedAt"=NOW(),"updatedAt"=NOW()
       WHERE type='USAGE_EXPORT_FAILURE'
         AND status='OPEN'
         AND metadata->>'eventId'=$1`,
      [event.id],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function openFailureReport(
  event: UsageExportRecord,
  message: string,
  reason: string,
): Promise<void> {
  const existing = await getDb().query(
    `SELECT id
     FROM "ReconciliationReport"
     WHERE type='USAGE_EXPORT_FAILURE'
       AND status='OPEN'
       AND metadata->>'eventId'=$1
     LIMIT 1`,
    [event.id],
  );
  if (existing.rows[0]) return;

  await getDb().query(
    `INSERT INTO "ReconciliationReport"
      (id,"orgId",type,status,findings,metadata,"createdAt","updatedAt")
     VALUES ($1,$2,'USAGE_EXPORT_FAILURE','OPEN',$3::jsonb,$4::jsonb,NOW(),NOW())`,
    [
      randomUUID(),
      event.orgId,
      JSON.stringify({
        eventId: event.id,
        product: event.product,
        meterName: event.meterName,
        quantity: event.quantity,
        attempts: event.exportAttempts,
        reason,
        message,
      }),
      JSON.stringify({
        eventId: event.id,
        product: event.product,
        meterName: event.meterName,
      }),
    ],
  );
}

async function markFailed(
  event: UsageExportRecord,
  error: unknown,
  forceTerminal = false,
  reason = "stripe_export_failed",
): Promise<void> {
  const message = failureMessage(error);
  const terminal =
    forceTerminal ||
    isPermanentFailure(error) ||
    event.exportAttempts >= MAX_EXPORT_ATTEMPTS;

  if (terminal) {
    const db = getDb();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE "UsageEvent"
         SET
           "exportStatus"='FAILED',
           "nextRetryAt"=NULL,
           "exportError"=$2,
           "updatedAt"=NOW()
         WHERE id=$1`,
        [event.id, message],
      );

      const existing = await client.query(
        `SELECT id
         FROM "ReconciliationReport"
         WHERE type='USAGE_EXPORT_FAILURE'
           AND status='OPEN'
           AND metadata->>'eventId'=$1
         LIMIT 1`,
        [event.id],
      );

      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO "ReconciliationReport"
            (id,"orgId",type,status,findings,metadata,"createdAt","updatedAt")
           VALUES ($1,$2,'USAGE_EXPORT_FAILURE','OPEN',$3::jsonb,$4::jsonb,NOW(),NOW())`,
          [
            randomUUID(),
            event.orgId,
            JSON.stringify({
              eventId: event.id,
              product: event.product,
              meterName: event.meterName,
              quantity: event.quantity,
              attempts: event.exportAttempts,
              reason,
              message,
            }),
            JSON.stringify({
              eventId: event.id,
              product: event.product,
              meterName: event.meterName,
            }),
          ],
        );
      }

      await client.query("COMMIT");
    } catch (transactionError) {
      await client.query("ROLLBACK");
      throw transactionError;
    } finally {
      client.release();
    }
    return;
  }

  await getDb().query(
    `UPDATE "UsageEvent"
     SET
       "exportStatus"='RETRY',
       "nextRetryAt"=$2,
       "exportError"=$3,
       "updatedAt"=NOW()
     WHERE id=$1`,
    [
      event.id,
      new Date(Date.now() + retryDelay(event.exportAttempts)),
      message,
    ],
  );
}

async function exportOne(
  stripe: Stripe,
  event: UsageExportRecord,
): Promise<void> {
  if (!meterIsCanonical(event)) {
    await markFailed(
      event,
      new Error("Usage meter is not present in the canonical catalog"),
      true,
      "meter_not_in_catalog",
    );
    return;
  }

  const customerId = await billingCustomerId(event.orgId);
  if (!customerId) {
    await markFailed(
      event,
      new Error("Organization has no Stripe billing customer mapping"),
      true,
      "billing_customer_missing",
    );
    return;
  }

  try {
    await stripe.billing.meterEvents.create(
      {
        event_name: event.meterName,
        payload: {
          stripe_customer_id: customerId,
          value: String(event.quantity),
        },
        timestamp: Math.floor(new Date(event.timestamp).getTime() / 1000),
        identifier: "migrateck_usage_" + event.id,
      },
      {
        idempotencyKey: "migrateck_usage_" + event.id,
      },
    );

    await markExported(event);
  } catch (error) {
    await markFailed(event, error);
  }
}

export async function recoverStaleUsageExports(): Promise<number> {
  const result = await getDb().query(
    `UPDATE "UsageEvent"
     SET
       "exportStatus"='RETRY',
       "exportError"=COALESCE("exportError",'stale export lease recovered'),
       "updatedAt"=NOW()
     WHERE "exportStatus"='RUNNING'
       AND "nextRetryAt"<=NOW()
     RETURNING id`,
  );
  return result.rowCount ?? 0;
}

export async function processUsageExportBatch(
  batchSize = 25,
): Promise<number> {
  const events = await claimUsageExports(batchSize);
  if (events.length === 0) return 0;

  const stripe = stripeClient();
  for (const event of events) {
    await exportOne(stripe, event);
  }
  return events.length;
}

export async function failExpiredUsageExports(): Promise<number> {
  const expired = await getDb().query<UsageExportRecord>(
    `UPDATE "UsageEvent"
     SET
       "exportStatus"='FAILED',
       "nextRetryAt"=NULL,
       "exportError"=COALESCE("exportError",'export attempts exhausted'),
       "updatedAt"=NOW()
     WHERE "meterName" IS NOT NULL
       AND "exportAttempts">=$1
       AND (
         "exportStatus" IN ('PENDING_EXPORT','RETRY')
         OR (
           "exportStatus"='RUNNING'
           AND "nextRetryAt"<=NOW()
         )
       )
     RETURNING
       id,"orgId",product::text AS product,metric::text AS metric,quantity::text AS quantity,
       "meterName","exportStatus","exportAttempts","nextRetryAt",timestamp`,
    [MAX_EXPORT_ATTEMPTS],
  );

  for (const event of expired.rows) {
    await openFailureReport(
      event,
      "Usage export exhausted all retry attempts",
      "retry_exhausted",
    );
  }

  return expired.rows.length;
}

export async function getUsageExportBacklog(): Promise<{
  pending: number;
  retrying: number;
  running: number;
  failed: number;
}> {
  const result = await getDb().query(
    `SELECT
       count(*) FILTER (WHERE "exportStatus"='PENDING_EXPORT')::int AS pending,
       count(*) FILTER (WHERE "exportStatus"='RETRY')::int AS retrying,
       count(*) FILTER (WHERE "exportStatus"='RUNNING')::int AS running,
       count(*) FILTER (WHERE "exportStatus"='FAILED')::int AS failed
     FROM "UsageEvent"
     WHERE "meterName" IS NOT NULL`,
  );
  return {
    pending: Number(result.rows[0]?.pending ?? 0),
    retrying: Number(result.rows[0]?.retrying ?? 0),
    running: Number(result.rows[0]?.running ?? 0),
    failed: Number(result.rows[0]?.failed ?? 0),
  };
}

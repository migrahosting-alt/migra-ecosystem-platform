import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PRODUCT_CATALOG } from "@migrateck/billing-core/catalog";
import type { FastifyRequest } from "fastify";
import type { ApiKeyPrincipal } from "./machine-auth.js";
import { getDb } from "./db.js";
import {
  CATALOG_FAMILY_TO_PRODUCT,
  PRODUCT_KEYS,
  type ProductKey,
} from "./commerce-catalog.js";

export const USAGE_METRICS = [
  "API_CALLS",
  "STORAGE_BYTES",
  "BANDWIDTH_BYTES",
  "SEATS",
  "EMAILS_SENT",
  "SMS_SENT",
  "BUILDS",
  "DEPLOYMENTS",
  "VPS_HOURS",
  "CUSTOM",
] as const;

export type UsageMetric = (typeof USAGE_METRICS)[number];
export type UsageWindow = "24h" | "7d" | "30d";

const WINDOW_INTERVALS: Record<UsageWindow, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

const EXPORTABLE_STATUSES = ["PENDING_EXPORT", "RETRY"] as const;

export type MeterDefinition = {
  productFamily: string;
  product: ProductKey;
  planCode: string;
  planName: string;
  lookupKey: string;
  meterName: string;
  metric: UsageMetric;
  billingInterval: string;
  unitAmount: number | null;
};

function metricForMeter(meterName: string): UsageMetric {
  switch (meterName) {
    case "email_sends":
      return "EMAILS_SENT";
    default:
      return "CUSTOM";
  }
}

export function getCatalogMeterDefinitions(): MeterDefinition[] {
  const definitions: MeterDefinition[] = [];

  for (const product of PRODUCT_CATALOG) {
    const productKey = CATALOG_FAMILY_TO_PRODUCT[product.productFamily];
    if (!productKey) continue;

    for (const plan of product.plans) {
      for (const price of plan.prices) {
        if (!price.meterName) continue;
        definitions.push({
          productFamily: product.productFamily,
          product: productKey,
          planCode: plan.planCode,
          planName: plan.name,
          lookupKey: price.lookupKey,
          meterName: price.meterName,
          metric: metricForMeter(price.meterName),
          billingInterval: price.billingInterval,
          unitAmount: price.unitAmount,
        });
      }
    }
  }

  return definitions;
}

function meterCandidates(product: ProductKey, meterName: string): MeterDefinition[] {
  return getCatalogMeterDefinitions().filter(
    (definition) =>
      definition.product === product && definition.meterName === meterName,
  );
}

function serializeUsageRow(row: Record<string, unknown>) {
  return {
    ...row,
    quantity:
      typeof row.quantity === "bigint"
        ? row.quantity.toString()
        : String(row.quantity ?? "0"),
  };
}

async function currentQuota(
  orgId: string,
  product: ProductKey,
  metric: UsageMetric,
) {
  const result = await getDb().query(
    `SELECT id,"limitValue"::text AS "limitValue","currentUsed"::text AS "currentUsed","periodStart","periodEnd"
     FROM "UsageQuota"
     WHERE "orgId"=$1
       AND product=$2::"ProductKey"
       AND metric=$3::"UsageMetric"
       AND "periodStart"<=NOW()
       AND "periodEnd">NOW()
     ORDER BY "periodStart" DESC
     LIMIT 1`,
    [orgId, product, metric],
  );
  return result.rows[0] ?? null;
}

export async function recordMachineUsage(input: {
  principal: ApiKeyPrincipal;
  product: ProductKey;
  meterName: string;
  quantity: number;
  idempotencyKey: string;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  const candidates = meterCandidates(input.product, input.meterName);
  if (candidates.length === 0) {
    throw Object.assign(
      new Error(
        "Meter is not declared in the canonical catalog for product " +
          input.product,
      ),
      { statusCode: 400 },
    );
  }

  const metric = candidates[0]!.metric;
  const occurredAt = input.occurredAt ?? new Date();
  const now = Date.now();
  if (occurredAt.getTime() > now + 5 * 60_000) {
    throw Object.assign(new Error("Usage timestamp cannot be in the future"), {
      statusCode: 400,
    });
  }
  if (occurredAt.getTime() < now - 35 * 24 * 60 * 60_000) {
    throw Object.assign(
      new Error("Usage timestamp is older than the 35-day Stripe meter ingestion window"),
      { statusCode: 400 },
    );
  }

  const metadata = {
    ...(input.metadata ?? {}),
    kind: "billable_usage",
    meter_name: input.meterName,
    catalog_lookup_keys: candidates.map((candidate) => candidate.lookupKey),
    api_key_id: input.principal.id,
    public_key_id: input.principal.publicKeyId,
  };

  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `INSERT INTO "UsageEvent"
        (id,"orgId",product,metric,quantity,metadata,timestamp,"meterName","idempotencyKey",source,"exportStatus","exportAttempts","createdAt","updatedAt")
       VALUES
        ($1,$2,$3::"ProductKey",$4::"UsageMetric",$5,$6::jsonb,$7,$8,$9,'api_key','PENDING_EXPORT',0,NOW(),NOW())
       ON CONFLICT ("idempotencyKey") DO NOTHING
       RETURNING id,"orgId",product::text AS product,metric::text AS metric,quantity,metadata,timestamp,"meterName","idempotencyKey",source,"exportStatus","exportAttempts","nextRetryAt","exportedAt","exportError","createdAt","updatedAt"`,
      [
        randomUUID(),
        input.principal.orgId,
        input.product,
        metric,
        input.quantity,
        JSON.stringify(metadata),
        occurredAt,
        input.meterName,
        input.idempotencyKey,
      ],
    );

    let event = inserted.rows[0];
    let duplicate = false;

    if (!event) {
      duplicate = true;
      const existing = await client.query(
        `SELECT id,"orgId",product::text AS product,metric::text AS metric,quantity,metadata,timestamp,"meterName","idempotencyKey",source,"exportStatus","exportAttempts","nextRetryAt","exportedAt","exportError","createdAt","updatedAt"
         FROM "UsageEvent"
         WHERE "idempotencyKey"=$1
         LIMIT 1`,
        [input.idempotencyKey],
      );
      event = existing.rows[0];

      if (
        !event ||
        event.orgId !== input.principal.orgId ||
        event.product !== input.product ||
        event.meterName !== input.meterName ||
        String(event.quantity) !== String(input.quantity)
      ) {
        throw Object.assign(
          new Error(
            "Idempotency key is already bound to a different usage event",
          ),
          { statusCode: 409 },
        );
      }
    } else {
      await client.query(
        `UPDATE "UsageQuota"
         SET "currentUsed"="currentUsed"+$1::bigint,"updatedAt"=NOW()
         WHERE "orgId"=$2
           AND product=$3::"ProductKey"
           AND metric=$4::"UsageMetric"
           AND "periodStart"<=NOW()
           AND "periodEnd">NOW()`,
        [input.quantity, input.principal.orgId, input.product, metric],
      );
    }

    await client.query("COMMIT");

    return {
      event: serializeUsageRow(event),
      duplicate,
      quota: await currentQuota(
        input.principal.orgId,
        input.product,
        metric,
      ),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function usageWorkerReadiness() {
  const path =
    process.env.USAGE_WORKER_HEARTBEAT_FILE ??
    "/run/migrateck-usage/heartbeat.json";

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as {
      workerId?: string;
      pid?: number;
      lastSeenAt?: string;
    };
    const lastSeenAt = parsed.lastSeenAt
      ? new Date(parsed.lastSeenAt)
      : null;
    const ageMs = lastSeenAt ? Date.now() - lastSeenAt.getTime() : Infinity;

    return {
      ready: Number.isFinite(ageMs) && ageMs <= 60_000,
      workerId: parsed.workerId ?? null,
      pid: parsed.pid ?? null,
      lastSeenAt: parsed.lastSeenAt ?? null,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
    };
  } catch {
    return {
      ready: false,
      workerId: null,
      pid: null,
      lastSeenAt: null,
      ageMs: null,
    };
  }
}

export async function getCommerceUsageSnapshot(window: UsageWindow) {
  const db = getDb();
  const interval = WINDOW_INTERVALS[window];

  const [
    summary,
    meters,
    recent,
    quotas,
    failures,
    reconciliations,
    orgCoverage,
    worker,
  ] = await Promise.all([
    db.query(
      `SELECT
         count(*) FILTER (WHERE "meterName" IS NOT NULL)::int AS billable_events,
         count(*) FILTER (WHERE "exportStatus" IN ('PENDING_EXPORT','RETRY'))::int AS pending_export,
         count(*) FILTER (WHERE "exportStatus"='FAILED')::int AS failed_export,
         count(*) FILTER (WHERE "exportStatus"='EXPORTED')::int AS exported,
         count(*) FILTER (WHERE "exportStatus"='LOCAL_ONLY')::int AS local_only,
         COALESCE(sum(quantity) FILTER (WHERE "meterName" IS NOT NULL),0)::text AS billable_quantity
       FROM "UsageEvent"
       WHERE timestamp>=NOW()-$1::interval`,
      [interval],
    ),
    db.query(
      `SELECT
         product::text AS product,
         "meterName",
         metric::text AS metric,
         count(*)::int AS events,
         COALESCE(sum(quantity),0)::text AS quantity,
         count(*) FILTER (WHERE "exportStatus"='EXPORTED')::int AS exported,
         count(*) FILTER (WHERE "exportStatus" IN ('PENDING_EXPORT','RETRY'))::int AS pending,
         count(*) FILTER (WHERE "exportStatus"='FAILED')::int AS failed,
         max(timestamp) AS "lastSeenAt"
       FROM "UsageEvent"
       WHERE "meterName" IS NOT NULL
         AND timestamp>=NOW()-$1::interval
       GROUP BY product,"meterName",metric
       ORDER BY sum(quantity) DESC,"lastSeenAt" DESC
       LIMIT 100`,
      [interval],
    ),
    db.query(
      `SELECT
         e.id,e."orgId",o.name AS "orgName",o.slug AS "orgSlug",
         e.product::text AS product,e.metric::text AS metric,e.quantity::text AS quantity,
         e."meterName",e."idempotencyKey",e.source,e."exportStatus",e."exportAttempts",
         e."nextRetryAt",e."exportedAt",e."exportError",e.metadata,e.timestamp,e."createdAt",e."updatedAt"
       FROM "UsageEvent" e
       JOIN "Organization" o ON o.id=e."orgId"
       WHERE e."meterName" IS NOT NULL
         AND e.timestamp>=NOW()-$1::interval
       ORDER BY e.timestamp DESC
       LIMIT 150`,
      [interval],
    ),
    db.query(
      `SELECT
         q.id,q."orgId",o.name AS "orgName",o.slug AS "orgSlug",
         q.product::text AS product,q.metric::text AS metric,
         q."limitValue"::text AS "limitValue",q."currentUsed"::text AS "currentUsed",
         q."periodStart",q."periodEnd",q."updatedAt"
       FROM "UsageQuota" q
       JOIN "Organization" o ON o.id=q."orgId"
       WHERE q."periodEnd">NOW()
       ORDER BY
         CASE WHEN q."limitValue">0 THEN q."currentUsed"::numeric/q."limitValue"::numeric ELSE 0 END DESC,
         q."periodEnd" ASC
       LIMIT 150`,
    ),
    db.query(
      `SELECT
         e.id,e."orgId",o.name AS "orgName",
         e.product::text AS product,e."meterName",e.quantity::text AS quantity,
         e."exportStatus",e."exportAttempts",e."nextRetryAt",e."exportError",e.timestamp
       FROM "UsageEvent" e
       JOIN "Organization" o ON o.id=e."orgId"
       WHERE e."meterName" IS NOT NULL
         AND e."exportStatus" IN ('FAILED','RETRY')
       ORDER BY e."updatedAt" DESC
       LIMIT 100`,
    ),
    db.query(
      `SELECT id,"orgId",type,status,findings,"resolvedAt",metadata,"createdAt","updatedAt"
       FROM "ReconciliationReport"
       ORDER BY "createdAt" DESC
       LIMIT 50`,
    ),
    db.query(
      `SELECT
         (
           SELECT count(DISTINCT "orgId")::int
           FROM "UsageEvent"
           WHERE "meterName" IS NOT NULL
         ) AS "meteredOrgs",
         (
           SELECT count(DISTINCT "orgId")::int
           FROM "BillingCustomer"
           WHERE provider='STRIPE'::"BillingProvider"
         ) AS "billingCustomers",
         (
           SELECT count(DISTINCT e."orgId")::int
           FROM "UsageEvent" e
           LEFT JOIN "BillingCustomer" c
             ON c."orgId"=e."orgId"
            AND c.provider='STRIPE'::"BillingProvider"
           WHERE e."meterName" IS NOT NULL
             AND c.id IS NULL
         ) AS "missingCustomerMappings"`,
    ),
    usageWorkerReadiness(),
  ]);

  return {
    window,
    meterDefinitions: getCatalogMeterDefinitions(),
    summary: {
      billableEvents: Number(summary.rows[0]?.billable_events ?? 0),
      pendingExport: Number(summary.rows[0]?.pending_export ?? 0),
      failedExport: Number(summary.rows[0]?.failed_export ?? 0),
      exported: Number(summary.rows[0]?.exported ?? 0),
      localOnly: Number(summary.rows[0]?.local_only ?? 0),
      billableQuantity: String(summary.rows[0]?.billable_quantity ?? "0"),
    },
    meterActivity: meters.rows,
    recentEvents: recent.rows,
    quotas: quotas.rows,
    exportFailures: failures.rows,
    reconciliations: reconciliations.rows,
    coverage: {
      meteredOrgs: Number(orgCoverage.rows[0]?.meteredOrgs ?? 0),
      billingCustomers: Number(orgCoverage.rows[0]?.billingCustomers ?? 0),
      missingCustomerMappings: Number(
        orgCoverage.rows[0]?.missingCustomerMappings ?? 0,
      ),
    },
    worker,
  };
}

export async function upsertUsageQuota(input: {
  orgId: string;
  product: ProductKey;
  metric: UsageMetric;
  limitValue: bigint;
  periodStart: Date;
  periodEnd: Date;
  actorId: string;
  request: FastifyRequest;
}) {
  if (input.periodEnd <= input.periodStart) {
    throw Object.assign(new Error("Quota period end must be after period start"), {
      statusCode: 400,
    });
  }
  if (input.limitValue < 0n) {
    throw Object.assign(new Error("Quota limit cannot be negative"), {
      statusCode: 400,
    });
  }

  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id,"limitValue"::text AS "limitValue","currentUsed"::text AS "currentUsed","periodEnd"
       FROM "UsageQuota"
       WHERE "orgId"=$1
         AND product=$2::"ProductKey"
         AND metric=$3::"UsageMetric"
         AND "periodStart"=$4
       FOR UPDATE`,
      [input.orgId, input.product, input.metric, input.periodStart],
    );

    const id = existing.rows[0]?.id ?? randomUUID();
    const saved = await client.query(
      `INSERT INTO "UsageQuota"
        (id,"orgId",product,metric,"limitValue","periodStart","periodEnd","currentUsed","createdAt","updatedAt")
       VALUES ($1,$2,$3::"ProductKey",$4::"UsageMetric",$5,$6,$7,0,NOW(),NOW())
       ON CONFLICT ("orgId",product,metric,"periodStart")
       DO UPDATE SET "limitValue"=EXCLUDED."limitValue","periodEnd"=EXCLUDED."periodEnd","updatedAt"=NOW()
       RETURNING id,"orgId",product::text AS product,metric::text AS metric,"limitValue"::text AS "limitValue","currentUsed"::text AS "currentUsed","periodStart","periodEnd","updatedAt"`,
      [
        id,
        input.orgId,
        input.product,
        input.metric,
        input.limitValue.toString(),
        input.periodStart,
        input.periodEnd,
      ],
    );

    await client.query(
      `INSERT INTO "AuditLog"
        (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt")
       VALUES ($1,$2,$3,'USAGE_QUOTA_UPSERTED','usage_quota',$4,$5,$6,$7::jsonb,NOW())`,
      [
        randomUUID(),
        input.actorId,
        input.orgId,
        saved.rows[0].id,
        input.request.ip ?? null,
        input.request.headers["user-agent"] ?? null,
        JSON.stringify({
          before: existing.rows[0] ?? null,
          after: saved.rows[0],
        }),
      ],
    );

    await client.query("COMMIT");
    return saved.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function retryUsageExport(input: {
  eventId: string;
  actorId: string;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const event = await client.query(
      `UPDATE "UsageEvent"
       SET "exportStatus"='PENDING_EXPORT',"exportAttempts"=0,"nextRetryAt"=NOW(),"exportError"=NULL,"updatedAt"=NOW()
       WHERE id=$1
         AND "meterName" IS NOT NULL
         AND "exportStatus" IN ('FAILED','RETRY')
       RETURNING id,"orgId",product::text AS product,"meterName","exportStatus"`,
      [input.eventId],
    );

    if (!event.rows[0]) {
      throw Object.assign(
        new Error("Retryable usage event was not found"),
        { statusCode: 404 },
      );
    }

    await client.query(
      `INSERT INTO "AuditLog"
        (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt")
       VALUES ($1,$2,$3,'USAGE_EXPORT_RETRY_REQUESTED','usage_event',$4,$5,$6,$7::jsonb,NOW())`,
      [
        randomUUID(),
        input.actorId,
        event.rows[0].orgId,
        input.eventId,
        input.request.ip ?? null,
        input.request.headers["user-agent"] ?? null,
        JSON.stringify(event.rows[0]),
      ],
    );

    await client.query("COMMIT");
    return event.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function assertUsageProduct(value: string): ProductKey {
  if (!(PRODUCT_KEYS as readonly string[]).includes(value)) {
    throw Object.assign(new Error("Unsupported product key"), {
      statusCode: 400,
    });
  }
  return value as ProductKey;
}

export function assertUsageMetric(value: string): UsageMetric {
  if (!(USAGE_METRICS as readonly string[]).includes(value)) {
    throw Object.assign(new Error("Unsupported usage metric"), {
      statusCode: 400,
    });
  }
  return value as UsageMetric;
}

export function isExportableUsageStatus(value: string): boolean {
  return (EXPORTABLE_STATUSES as readonly string[]).includes(value);
}


export async function getMachineQuotaStatus(
  orgId: string,
  product: ProductKey,
  metric: UsageMetric,
) {
  const quota = await currentQuota(orgId, product, metric);
  if (!quota) {
    return {
      limited: false,
      limitValue: null,
      currentUsed: null,
      remaining: null,
      periodStart: null,
      periodEnd: null,
    };
  }

  const limit = BigInt(quota.limitValue);
  const used = BigInt(quota.currentUsed);
  const remaining = limit > used ? limit - used : 0n;

  return {
    limited: true,
    limitValue: quota.limitValue,
    currentUsed: quota.currentUsed,
    remaining: remaining.toString(),
    periodStart: quota.periodStart,
    periodEnd: quota.periodEnd,
  };
}

export async function resolveUsageReconciliation(input: {
  reportId: string;
  actorId: string;
  request: FastifyRequest;
  note?: string | null;
}) {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const resolved = await client.query(
      `UPDATE "ReconciliationReport"
       SET status='RESOLVED',"resolvedAt"=NOW(),"updatedAt"=NOW(),
           metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb
       WHERE id=$1
         AND status='OPEN'
       RETURNING id,"orgId",type,status,"resolvedAt"`,
      [
        input.reportId,
        JSON.stringify({
          resolvedBy: input.actorId,
          resolutionNote: input.note ?? null,
        }),
      ],
    );

    if (!resolved.rows[0]) {
      throw Object.assign(new Error("Open reconciliation report not found"), {
        statusCode: 404,
      });
    }

    await client.query(
      `INSERT INTO "AuditLog"
        (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt")
       VALUES ($1,$2,$3,'USAGE_RECONCILIATION_RESOLVED','reconciliation_report',$4,$5,$6,$7::jsonb,NOW())`,
      [
        randomUUID(),
        input.actorId,
        resolved.rows[0].orgId,
        input.reportId,
        input.request.ip ?? null,
        input.request.headers["user-agent"] ?? null,
        JSON.stringify({
          type: resolved.rows[0].type,
          note: input.note ?? null,
        }),
      ],
    );

    await client.query("COMMIT");
    return resolved.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

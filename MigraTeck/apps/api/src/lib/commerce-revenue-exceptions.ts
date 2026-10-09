import { getDb } from "./db.js";

export const REVENUE_EXCEPTION_KINDS = [
  "subscription_payment_risk",
  "invoice_open_balance",
  "invoice_uncollectible",
  "stripe_webhook_failed",
  "stripe_webhook_stalled",
  "billing_identity_missing",
  "billing_identity_mismatch",
] as const;

export type RevenueExceptionKind = (typeof REVENUE_EXCEPTION_KINDS)[number];
export type RevenueExceptionSeverity = "critical" | "warning";

export type RevenueExceptionQuery = {
  kind?: RevenueExceptionKind;
  severity?: RevenueExceptionSeverity;
  q?: string;
  limit?: number;
  offset?: number;
};

function normalizedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(1, Math.floor(value ?? 50)));
}

function normalizedOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1_000_000, Math.max(0, Math.floor(value ?? 0)));
}

const EXCEPTIONS_CTE = [
  "WITH exceptions AS (",
  "SELECT",
  "'subscription_payment_risk'::text AS kind,",
  "'critical'::text AS severity,",
  's."orgId" AS "orgId",o.name AS "orgName",o.slug AS "orgSlug",',
  '\'subscription\'::text AS "entityType",s.id AS "entityId",',
  'COALESCE(s."updatedAt",s."createdAt") AS "occurredAt",',
  "jsonb_build_object(",
  "'status',s.status::text,",
  "'externalSubscriptionId',s.\"externalSubscriptionId\",",
  "'currentPeriodEnd',s.\"currentPeriodEnd\",",
  "'cancelAtPeriodEnd',s.\"cancelAtPeriodEnd\"",
  ") AS evidence",
  'FROM "BillingSubscription" s',
  'JOIN "Organization" o ON o.id=s."orgId"',
  "WHERE s.status::text IN ('PAST_DUE','UNPAID','INCOMPLETE','INCOMPLETE_EXPIRED')",
  "",
  "UNION ALL",
  "",
  "SELECT",
  "CASE WHEN lower(i.status)='uncollectible' THEN 'invoice_uncollectible' ELSE 'invoice_open_balance' END AS kind,",
  "CASE WHEN lower(i.status)='uncollectible' THEN 'critical' ELSE 'warning' END AS severity,",
  'i."orgId" AS "orgId",o.name AS "orgName",o.slug AS "orgSlug",',
  '\'invoice\'::text AS "entityType",i.id AS "entityId",',
  'COALESCE(i."updatedAt",i."createdAt") AS "occurredAt",',
  "jsonb_build_object(",
  "'stripeInvoiceId',i.\"stripeInvoiceId\",",
  "'number',i.number,",
  "'status',i.status,",
  "'currency',i.currency,",
  "'total',i.total,",
  "'amountPaid',i.\"amountPaid\",",
  "'amountRemaining',i.\"amountRemaining\",",
  "'finalizedAt',i.\"finalizedAt\",",
  "'paidAt',i.\"paidAt\"",
  ") AS evidence",
  'FROM "BillingInvoice" i',
  'JOIN "Organization" o ON o.id=i."orgId"',
  "WHERE (lower(i.status)='open' AND i.\"amountRemaining\">0)",
  "OR lower(i.status)='uncollectible'",
  "",
  "UNION ALL",
  "",
  "SELECT",
  "CASE WHEN e.status::text='FAILED' THEN 'stripe_webhook_failed' ELSE 'stripe_webhook_stalled' END AS kind,",
  "CASE WHEN e.status::text='FAILED' THEN 'critical' ELSE 'warning' END AS severity,",
  'NULL::text AS "orgId",NULL::text AS "orgName",NULL::text AS "orgSlug",',
  '\'webhook_event\'::text AS "entityType",e.id AS "entityId",',
  'COALESCE(e."updatedAt",e."receivedAt") AS "occurredAt",',
  "jsonb_build_object(",
  "'eventId',e.\"eventId\",",
  "'eventType',e.\"eventType\",",
  "'status',e.status::text,",
  "'attempts',e.attempts,",
  "'receivedAt',e.\"receivedAt\",",
  "'processedAt',e.\"processedAt\",",
  "'livemode',e.livemode",
  ") AS evidence",
  'FROM "BillingWebhookEvent" e',
  "WHERE e.status::text='FAILED'",
  "OR (e.status::text IN ('RECEIVED','QUEUED','PROCESSING')",
  "AND e.\"receivedAt\" < NOW() - INTERVAL '10 minutes')",
  "",
  "UNION ALL",
  "",
  "SELECT",
  "'billing_identity_missing'::text AS kind,",
  "'critical'::text AS severity,",
  'o.id AS "orgId",o.name AS "orgName",o.slug AS "orgSlug",',
  '\'organization\'::text AS "entityType",o.id AS "entityId",',
  "COALESCE(",
  '(SELECT max(s."updatedAt") FROM "BillingSubscription" s WHERE s."orgId"=o.id),',
  '(SELECT max(i."updatedAt") FROM "BillingInvoice" i WHERE i."orgId"=o.id),',
  'st."updatedAt",o."updatedAt"',
  ') AS "occurredAt",',
  "jsonb_build_object(",
  '\'subscriptions\',(SELECT count(*)::int FROM "BillingSubscription" s WHERE s."orgId"=o.id),',
  '\'invoices\',(SELECT count(*)::int FROM "BillingInvoice" i WHERE i."orgId"=o.id),',
  "'standing',st.standing",
  ") AS evidence",
  'FROM "Organization" o',
  'LEFT JOIN "BillingCustomer" c ON c."orgId"=o.id',
  'LEFT JOIN "BillingOrgState" st ON st."orgId"=o.id',
  "WHERE c.id IS NULL AND (",
  'EXISTS (SELECT 1 FROM "BillingSubscription" s WHERE s."orgId"=o.id)',
  'OR EXISTS (SELECT 1 FROM "BillingInvoice" i WHERE i."orgId"=o.id)',
  'OR EXISTS (SELECT 1 FROM "BillingOrgState" state WHERE state."orgId"=o.id)',
  ")",
  "",
  "UNION ALL",
  "",
  "SELECT",
  "'billing_identity_mismatch'::text AS kind,",
  "'critical'::text AS severity,",
  'c."orgId" AS "orgId",o.name AS "orgName",o.slug AS "orgSlug",',
  '\'organization\'::text AS "entityType",c."orgId" AS "entityId",',
  'GREATEST(c."updatedAt",st."updatedAt") AS "occurredAt",',
  "jsonb_build_object(",
  "'customerId',c.\"externalCustomerId\",",
  "'stateCustomerId',st.\"stripeCustomerId\",",
  "'standing',st.standing",
  ") AS evidence",
  'FROM "BillingCustomer" c',
  'JOIN "Organization" o ON o.id=c."orgId"',
  'JOIN "BillingOrgState" st ON st."orgId"=c."orgId"',
  'WHERE st."stripeCustomerId" IS NOT NULL',
  'AND st."stripeCustomerId"<>c."externalCustomerId"',
  ")",
].join(" ");

export async function getRevenueExceptions(input: RevenueExceptionQuery = {}) {
  const db = getDb();
  const clauses: string[] = [];
  const values: unknown[] = [];

  const addValue = (value: unknown) => {
    values.push(value);
    return "$" + values.length;
  };

  if (input.kind) {
    clauses.push("kind=" + addValue(input.kind));
  }
  if (input.severity) {
    clauses.push("severity=" + addValue(input.severity));
  }
  if (input.q?.trim()) {
    const ref = addValue("%" + input.q.trim().slice(0, 160) + "%");
    clauses.push(
      "(kind ILIKE " +
        ref +
        ' OR "entityId" ILIKE ' +
        ref +
        " OR COALESCE(\"orgName\",'') ILIKE " +
        ref +
        " OR COALESCE(\"orgSlug\",'') ILIKE " +
        ref +
        ")",
    );
  }

  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const limit = normalizedLimit(input.limit);
  const offset = normalizedOffset(input.offset);

  const summaryResult = await db.query<{
    total: number;
    critical: number;
    warning: number;
    newestAt: string | null;
    oldestAt: string | null;
  }>(
    [
      EXCEPTIONS_CTE,
      "SELECT",
      "count(*)::int AS total,",
      "count(*) FILTER (WHERE severity='critical')::int AS critical,",
      "count(*) FILTER (WHERE severity='warning')::int AS warning,",
      'max("occurredAt") AS "newestAt",',
      'min("occurredAt") AS "oldestAt"',
      "FROM exceptions",
      where,
    ].join(" "),
    [...values],
  );

  const kindResult = await db.query<{
    kind: RevenueExceptionKind;
    count: number;
  }>(
    [
      EXCEPTIONS_CTE,
      "SELECT kind,count(*)::int AS count",
      "FROM exceptions",
      where,
      "GROUP BY kind",
      "ORDER BY count(*) DESC,kind",
    ].join(" "),
    [...values],
  );

  const rowValues = [...values, limit, offset];
  const limitRef = "$" + (rowValues.length - 1);
  const offsetRef = "$" + rowValues.length;

  const rows = await db.query<{
    kind: RevenueExceptionKind;
    severity: RevenueExceptionSeverity;
    orgId: string | null;
    orgName: string | null;
    orgSlug: string | null;
    entityType: string;
    entityId: string;
    occurredAt: string;
    evidence: Record<string, unknown>;
  }>(
    [
      EXCEPTIONS_CTE,
      'SELECT kind,severity,"orgId","orgName","orgSlug","entityType","entityId","occurredAt",evidence',
      "FROM exceptions",
      where,
      'ORDER BY "occurredAt" DESC NULLS LAST,kind,"entityId"',
      "LIMIT " + limitRef + " OFFSET " + offsetRef,
    ].join(" "),
    rowValues,
  );

  const summary = summaryResult.rows[0] ?? {
    total: 0,
    critical: 0,
    warning: 0,
    newestAt: null,
    oldestAt: null,
  };

  const byKind = Object.fromEntries(
    REVENUE_EXCEPTION_KINDS.map((kind) => [kind, 0]),
  ) as Record<RevenueExceptionKind, number>;

  for (const row of kindResult.rows) {
    byKind[row.kind] = Number(row.count ?? 0);
  }

  return {
    total: Number(summary.total ?? 0),
    limit,
    offset,
    summary: {
      critical: Number(summary.critical ?? 0),
      warning: Number(summary.warning ?? 0),
      newestAt: summary.newestAt ?? null,
      oldestAt: summary.oldestAt ?? null,
    },
    byKind,
    exceptions: rows.rows,
  };
}

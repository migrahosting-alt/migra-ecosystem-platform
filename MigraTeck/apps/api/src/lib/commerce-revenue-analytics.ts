import { getDb } from "./db.js";

export const REVENUE_ANALYTICS_WINDOWS = [30, 90, 180, 365] as const;

export type RevenueAnalyticsWindow = (typeof REVENUE_ANALYTICS_WINDOWS)[number];

export type RevenueAnalyticsQuery = {
  windowDays?: RevenueAnalyticsWindow;
};

type Numeric = number | string | null;
type Timestamp = Date | string | null;

function asNumber(value: Numeric | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asIso(value: Timestamp | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizedWindow(
  value: RevenueAnalyticsWindow | undefined,
): RevenueAnalyticsWindow {
  return value && REVENUE_ANALYTICS_WINDOWS.includes(value) ? value : 180;
}

const COVERAGE_SQL = [
  "WITH billing_orgs AS (",
  'SELECT "orgId" FROM "BillingCustomer"',
  'UNION SELECT "orgId" FROM "BillingSubscription"',
  'UNION SELECT "orgId" FROM "BillingInvoice"',
  'UNION SELECT "orgId" FROM "BillingOrgState"',
  "), evidence AS (",
  'SELECT "createdAt" AS ts FROM "BillingCustomer"',
  'UNION ALL SELECT "updatedAt" FROM "BillingCustomer"',
  'UNION ALL SELECT "createdAt" FROM "BillingSubscription"',
  'UNION ALL SELECT "updatedAt" FROM "BillingSubscription"',
  'UNION ALL SELECT "createdAt" FROM "BillingInvoice"',
  'UNION ALL SELECT "updatedAt" FROM "BillingInvoice"',
  'UNION ALL SELECT "updatedAt" FROM "BillingOrgState"',
  'UNION ALL SELECT "receivedAt" FROM "BillingWebhookEvent"',
  'UNION ALL SELECT "updatedAt" FROM "BillingWebhookEvent"',
  ") SELECT",
  '(SELECT count(*)::int FROM "BillingCustomer") AS "customerCount",',
  '(SELECT count(*)::int FROM billing_orgs) AS "billingOrganizationCount",',
  '(SELECT count(*)::int FROM "BillingSubscription") AS "subscriptionCount",',
  '(SELECT count(*)::int FROM "BillingInvoice") AS "invoiceCount",',
  '(SELECT count(*)::int FROM "BillingOrgState") AS "orgStateCount",',
  '(SELECT count(*)::int FROM "BillingWebhookEvent") AS "webhookEventCount",',
  '(SELECT min(ts) FROM evidence) AS "earliestAt",',
  '(SELECT max(ts) FROM evidence) AS "latestAt"',
].join(" ");

const MONEY_SQL = [
  "SELECT",
  "lower(COALESCE(NULLIF(currency,''),'unknown')) AS currency,",
  'count(*)::int AS "invoiceCount",',
  'count(*) FILTER (WHERE "finalizedAt" IS NOT NULL)::int AS "finalizedInvoiceCount",',
  "count(*) FILTER (WHERE lower(status)='paid')::int AS \"paidInvoiceCount\",",
  'count(*) FILTER (WHERE lower(status)=\'open\' AND "amountRemaining">0)::int AS "openInvoiceCount",',
  "count(*) FILTER (WHERE lower(status)='uncollectible')::int AS \"uncollectibleInvoiceCount\",",
  'COALESCE(sum(total) FILTER (WHERE "finalizedAt" IS NOT NULL),0)::bigint AS "finalizedAmount",',
  'COALESCE(sum("amountPaid"),0)::bigint AS "amountPaid",',
  'COALESCE(sum("amountRemaining") FILTER (WHERE lower(status)=\'open\'),0)::bigint AS "openAmount",',
  'COALESCE(sum("amountRemaining") FILTER (WHERE lower(status)=\'uncollectible\'),0)::bigint AS "uncollectibleAmount"',
  'FROM "BillingInvoice"',
  "GROUP BY lower(COALESCE(NULLIF(currency,''),'unknown'))",
  "ORDER BY currency",
].join(" ");

const AGING_SQL = [
  "SELECT",
  "lower(COALESCE(NULLIF(currency,''),'unknown')) AS currency,",
  "CASE",
  "WHEN \"finalizedAt\" IS NULL THEN 'unfinalized'",
  "WHEN \"finalizedAt\" >= NOW() - INTERVAL '30 days' THEN '0_30'",
  "WHEN \"finalizedAt\" >= NOW() - INTERVAL '60 days' THEN '31_60'",
  "WHEN \"finalizedAt\" >= NOW() - INTERVAL '90 days' THEN '61_90'",
  "ELSE '91_plus' END AS bucket,",
  'count(*)::int AS "invoiceCount",',
  'COALESCE(sum("amountRemaining"),0)::bigint AS amount',
  'FROM "BillingInvoice"',
  "WHERE lower(status)='open' AND \"amountRemaining\">0",
  "GROUP BY lower(COALESCE(NULLIF(currency,''),'unknown')),bucket",
  "ORDER BY currency,bucket",
].join(" ");

const SUBSCRIPTION_SQL = [
  "SELECT",
  "status::text AS status,",
  'count(*)::int AS "subscriptionCount",',
  'count(*) FILTER (WHERE "cancelAtPeriodEnd"=true)::int AS "cancelAtPeriodEndCount"',
  'FROM "BillingSubscription"',
  "GROUP BY status::text",
  "ORDER BY status::text",
].join(" ");

const PROCESSOR_SQL = [
  "SELECT",
  'count(*)::int AS "eventCount",',
  'count(*) FILTER (WHERE "receivedAt">=NOW()-INTERVAL \'24 hours\')::int AS "receivedLast24h",',
  "count(*) FILTER (WHERE status::text='FAILED' AND \"receivedAt\">=NOW()-INTERVAL '24 hours')::int AS \"failedLast24h\",",
  'count(*) FILTER (WHERE status::text=\'PROCESSED\' AND COALESCE("processedAt","lastProcessedAt")>=NOW()-INTERVAL \'24 hours\')::int AS "processedLast24h",',
  "count(*) FILTER (WHERE status::text IN ('RECEIVED','QUEUED','PROCESSING') AND \"receivedAt\"<NOW()-INTERVAL '10 minutes')::int AS \"stalledTotal\",",
  'max("receivedAt") AS "latestReceivedAt",',
  'max(COALESCE("processedAt","lastProcessedAt")) AS "latestProcessedAt"',
  'FROM "BillingWebhookEvent"',
].join(" ");

const TREND_SQL = [
  "SELECT",
  "to_char(date_trunc('month',COALESCE(\"finalizedAt\",\"createdAt\")),'YYYY-MM') AS period,",
  "lower(COALESCE(NULLIF(currency,''),'unknown')) AS currency,",
  'count(*)::int AS "invoiceCount",',
  'count(*) FILTER (WHERE "finalizedAt" IS NOT NULL)::int AS "finalizedInvoiceCount",',
  'COALESCE(sum(total) FILTER (WHERE "finalizedAt" IS NOT NULL),0)::bigint AS "finalizedAmount",',
  'COALESCE(sum("amountPaid"),0)::bigint AS "amountPaid",',
  'COALESCE(sum("amountRemaining") FILTER (WHERE lower(status)=\'open\'),0)::bigint AS "openAmount"',
  'FROM "BillingInvoice"',
  'WHERE COALESCE("finalizedAt","createdAt") >= NOW() - make_interval(days => $1)',
  "GROUP BY period,lower(COALESCE(NULLIF(currency,''),'unknown'))",
  "ORDER BY period,currency",
].join(" ");

export async function getCommerceRevenueAnalytics(
  input: RevenueAnalyticsQuery = {},
) {
  const db = getDb();
  const windowDays = normalizedWindow(input.windowDays);

  const [
    coverageResult,
    moneyResult,
    agingResult,
    subscriptionResult,
    processorResult,
    trendResult,
  ] = await Promise.all([
    db.query<{
      customerCount: number;
      billingOrganizationCount: number;
      subscriptionCount: number;
      invoiceCount: number;
      orgStateCount: number;
      webhookEventCount: number;
      earliestAt: Timestamp;
      latestAt: Timestamp;
    }>(COVERAGE_SQL),
    db.query<{
      currency: string;
      invoiceCount: number;
      finalizedInvoiceCount: number;
      paidInvoiceCount: number;
      openInvoiceCount: number;
      uncollectibleInvoiceCount: number;
      finalizedAmount: Numeric;
      amountPaid: Numeric;
      openAmount: Numeric;
      uncollectibleAmount: Numeric;
    }>(MONEY_SQL),
    db.query<{
      currency: string;
      bucket: "unfinalized" | "0_30" | "31_60" | "61_90" | "91_plus";
      invoiceCount: number;
      amount: Numeric;
    }>(AGING_SQL),
    db.query<{
      status: string;
      subscriptionCount: number;
      cancelAtPeriodEndCount: number;
    }>(SUBSCRIPTION_SQL),
    db.query<{
      eventCount: number;
      receivedLast24h: number;
      failedLast24h: number;
      processedLast24h: number;
      stalledTotal: number;
      latestReceivedAt: Timestamp;
      latestProcessedAt: Timestamp;
    }>(PROCESSOR_SQL),
    db.query<{
      period: string;
      currency: string;
      invoiceCount: number;
      finalizedInvoiceCount: number;
      finalizedAmount: Numeric;
      amountPaid: Numeric;
      openAmount: Numeric;
    }>(TREND_SQL, [windowDays]),
  ]);

  const coverage = coverageResult.rows[0] ?? {
    customerCount: 0,
    billingOrganizationCount: 0,
    subscriptionCount: 0,
    invoiceCount: 0,
    orgStateCount: 0,
    webhookEventCount: 0,
    earliestAt: null,
    latestAt: null,
  };

  const hasTransactionalEvidence =
    Number(coverage.invoiceCount ?? 0) > 0 ||
    Number(coverage.subscriptionCount ?? 0) > 0 ||
    Number(coverage.webhookEventCount ?? 0) > 0;

  const hasIdentityEvidence =
    Number(coverage.customerCount ?? 0) > 0 ||
    Number(coverage.orgStateCount ?? 0) > 0;

  const activityState = hasTransactionalEvidence
    ? "observed"
    : hasIdentityEvidence
      ? "identity_only"
      : "empty";

  const agingByCurrency = new Map<
    string,
    {
      currency: string;
      unfinalized: { invoiceCount: number; amount: number };
      "0_30": { invoiceCount: number; amount: number };
      "31_60": { invoiceCount: number; amount: number };
      "61_90": { invoiceCount: number; amount: number };
      "91_plus": { invoiceCount: number; amount: number };
    }
  >();

  for (const row of agingResult.rows) {
    const entry = agingByCurrency.get(row.currency) ?? {
      currency: row.currency,
      unfinalized: { invoiceCount: 0, amount: 0 },
      "0_30": { invoiceCount: 0, amount: 0 },
      "31_60": { invoiceCount: 0, amount: 0 },
      "61_90": { invoiceCount: 0, amount: 0 },
      "91_plus": { invoiceCount: 0, amount: 0 },
    };
    entry[row.bucket] = {
      invoiceCount: Number(row.invoiceCount ?? 0),
      amount: asNumber(row.amount),
    };
    agingByCurrency.set(row.currency, entry);
  }

  const processor = processorResult.rows[0] ?? {
    eventCount: 0,
    receivedLast24h: 0,
    failedLast24h: 0,
    processedLast24h: 0,
    stalledTotal: 0,
    latestReceivedAt: null,
    latestProcessedAt: null,
  };

  return {
    windowDays,
    evidence: {
      activityState,
      customerCount: Number(coverage.customerCount ?? 0),
      billingOrganizationCount: Number(coverage.billingOrganizationCount ?? 0),
      subscriptionCount: Number(coverage.subscriptionCount ?? 0),
      invoiceCount: Number(coverage.invoiceCount ?? 0),
      orgStateCount: Number(coverage.orgStateCount ?? 0),
      webhookEventCount: Number(coverage.webhookEventCount ?? 0),
      earliestAt: asIso(coverage.earliestAt),
      latestAt: asIso(coverage.latestAt),
    },
    invoices: {
      accountingBasis: "operational_invoice_evidence",
      revenueRecognition: false,
      byCurrency: moneyResult.rows.map((row) => ({
        currency: row.currency,
        invoiceCount: Number(row.invoiceCount ?? 0),
        finalizedInvoiceCount: Number(row.finalizedInvoiceCount ?? 0),
        paidInvoiceCount: Number(row.paidInvoiceCount ?? 0),
        openInvoiceCount: Number(row.openInvoiceCount ?? 0),
        uncollectibleInvoiceCount: Number(row.uncollectibleInvoiceCount ?? 0),
        finalizedAmount: asNumber(row.finalizedAmount),
        amountPaid: asNumber(row.amountPaid),
        openAmount: asNumber(row.openAmount),
        uncollectibleAmount: asNumber(row.uncollectibleAmount),
      })),
    },
    receivables: {
      ageBasis: "invoice_finalized_at",
      dueDateAvailable: false,
      byCurrency: [...agingByCurrency.values()].sort((a, b) =>
        a.currency.localeCompare(b.currency),
      ),
    },
    subscriptions: {
      total: Number(coverage.subscriptionCount ?? 0),
      byStatus: subscriptionResult.rows.map((row) => ({
        status: row.status,
        subscriptionCount: Number(row.subscriptionCount ?? 0),
        cancelAtPeriodEndCount: Number(row.cancelAtPeriodEndCount ?? 0),
      })),
    },
    processor: {
      evidenceAvailable: Number(processor.eventCount ?? 0) > 0,
      eventCount: Number(processor.eventCount ?? 0),
      receivedLast24h: Number(processor.receivedLast24h ?? 0),
      failedLast24h: Number(processor.failedLast24h ?? 0),
      processedLast24h: Number(processor.processedLast24h ?? 0),
      stalledTotal: Number(processor.stalledTotal ?? 0),
      latestReceivedAt: asIso(processor.latestReceivedAt),
      latestProcessedAt: asIso(processor.latestProcessedAt),
    },
    trend: trendResult.rows.map((row) => ({
      period: row.period,
      currency: row.currency,
      invoiceCount: Number(row.invoiceCount ?? 0),
      finalizedInvoiceCount: Number(row.finalizedInvoiceCount ?? 0),
      finalizedAmount: asNumber(row.finalizedAmount),
      amountPaid: asNumber(row.amountPaid),
      openAmount: asNumber(row.openAmount),
    })),
  };
}

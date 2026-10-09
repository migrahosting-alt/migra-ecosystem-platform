import { readFile } from "node:fs/promises";
import Stripe from "stripe";
import { getDb } from "./db.js";

export const CANONICAL_STRIPE_WEBHOOK_URL =
  "https://migrateck.com/v1/billing/webhooks/stripe";

export const CANONICAL_STRIPE_WEBHOOK_API_VERSION = "2025-07-30.basil";

export const CANONICAL_STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.created",
  "invoice.updated",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
  "invoice.payment_action_required",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_method.attached",
  "payment_method.detached",
] as const;

export type BillingReadinessSeverity = "critical" | "warning";

export type BillingReadinessIssue = {
  code: string;
  severity: BillingReadinessSeverity;
  title: string;
  detail: string;
};

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw Object.assign(new Error("Stripe processor is not configured"), {
      statusCode: 503,
    });
  }
  return new Stripe(key, {
    apiVersion: "2025-04-30.basil" as Stripe.LatestApiVersion,
    typescript: true,
  });
}

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type BillingReconciliationHeartbeat = {
  workerId?: unknown;
  pid?: unknown;
  lastSeenAt?: unknown;
  startedAt?: unknown;
  pollIntervalMs?: unknown;
  minimumSyncAgeMs?: unknown;
  batchSize?: unknown;
  cycles?: unknown;
  lastCycleAt?: unknown;
  lastSuccessAt?: unknown;
  lastBatch?: unknown;
};

function reconciliationHeartbeatFile(): string {
  return (
    process.env.BILLING_RECONCILIATION_HEARTBEAT_FILE ??
    "/run/migrateck-billing-reconcile/heartbeat.json"
  );
}

function staleReconciliationAfterMs(): number {
  const parsed = Number(
    process.env.BILLING_RECONCILIATION_STALE_AFTER_MS ?? 2 * 60 * 60_000,
  );
  return Number.isFinite(parsed) && parsed >= 5 * 60_000
    ? Math.min(parsed, 48 * 60 * 60_000)
    : 2 * 60 * 60_000;
}

async function readBillingReconciliationHeartbeat() {
  try {
    const raw = await readFile(reconciliationHeartbeatFile(), "utf8");
    const parsed = JSON.parse(raw) as BillingReconciliationHeartbeat;
    const lastSeenAt =
      typeof parsed.lastSeenAt === "string" ? asIso(parsed.lastSeenAt) : null;
    const pollIntervalMs = Math.max(
      15_000,
      Math.min(asNumber(parsed.pollIntervalMs) || 60_000, 60 * 60_000),
    );
    const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
    const livenessWindowMs = Math.max(120_000, pollIntervalMs * 3 + 15_000);
    const lastBatch =
      parsed.lastBatch && typeof parsed.lastBatch === "object"
        ? (parsed.lastBatch as Record<string, unknown>)
        : null;

    return {
      heartbeatPresent: true,
      live: lastSeenMs > 0 && Date.now() - lastSeenMs <= livenessWindowMs,
      lastSeenAt,
      startedAt:
        typeof parsed.startedAt === "string" ? asIso(parsed.startedAt) : null,
      pollIntervalMs,
      minimumSyncAgeMs: asNumber(parsed.minimumSyncAgeMs),
      batchSize: asNumber(parsed.batchSize),
      cycles: asNumber(parsed.cycles),
      lastCycleAt:
        typeof parsed.lastCycleAt === "string"
          ? asIso(parsed.lastCycleAt)
          : null,
      lastSuccessAt:
        typeof parsed.lastSuccessAt === "string"
          ? asIso(parsed.lastSuccessAt)
          : null,
      lastBatch: lastBatch
        ? {
            selected: asNumber(lastBatch.selected),
            attempted: asNumber(lastBatch.attempted),
            succeeded: asNumber(lastBatch.succeeded),
            skippedLocked: asNumber(lastBatch.skippedLocked),
            skippedMissingMapping: asNumber(lastBatch.skippedMissingMapping),
            failed: asNumber(lastBatch.failed),
          }
        : null,
    };
  } catch {
    return {
      heartbeatPresent: false,
      live: false,
      lastSeenAt: null,
      startedAt: null,
      pollIntervalMs: 0,
      minimumSyncAgeMs: 0,
      batchSize: 0,
      cycles: 0,
      lastCycleAt: null,
      lastSuccessAt: null,
      lastBatch: null,
    };
  }
}

const LEDGER_SQL = [
  "SELECT",
  '(SELECT count(*)::int FROM "BillingCustomer") AS "customerCount",',
  '(SELECT count(*)::int FROM "BillingOrgState") AS "orgStateCount",',
  '(SELECT count(*)::int FROM "BillingSubscription") AS "subscriptionCount",',
  '(SELECT count(*)::int FROM "BillingInvoice") AS "invoiceCount",',
  '(SELECT count(*)::int FROM "BillingWebhookEvent") AS "webhookEventCount",',
  '(SELECT count(*)::int FROM "BillingEventProjection") AS "projectionCount",',
  '(SELECT count(*)::int FROM "BillingWebhookEvent" WHERE status::text=\'PROCESSED\') AS "processedWebhookCount",',
  '(SELECT count(*)::int FROM "BillingWebhookEvent" WHERE status::text=\'IGNORED\') AS "ignoredWebhookCount",',
  '(SELECT count(*)::int FROM "BillingWebhookEvent" WHERE status::text=\'FAILED\') AS "failedWebhookCount",',
  "(SELECT count(*)::int FROM \"BillingWebhookEvent\" WHERE status::text IN ('RECEIVED','QUEUED','PROCESSING') AND \"receivedAt\"<NOW()-INTERVAL '10 minutes') AS \"stalledWebhookCount\",",
  "(SELECT count(*)::int FROM \"BillingWebhookEvent\" WHERE status::text='IGNORED' AND reason='Stripe customer is not mapped to a platform organization') AS \"unmappedIgnoredCount\",",
  '(SELECT max("receivedAt") FROM "BillingWebhookEvent") AS "latestWebhookAt",',
  '(SELECT max("lastSyncedAt") FROM "BillingOrgState") AS "latestSyncAt"',
].join(" ");

const ORGANIZATIONS_SQL = [
  "SELECT",
  'o.id AS "orgId",o.name AS "orgName",o.slug AS "orgSlug",',
  'c."createdAt" AS "customerMappedAt",c."updatedAt" AS "customerUpdatedAt",',
  'state."lastSyncedAt" AS "lastSyncedAt",',
  '(SELECT count(*)::int FROM "BillingSubscription" s WHERE s."orgId"=o.id) AS "subscriptionCount",',
  '(SELECT count(*)::int FROM "BillingInvoice" i WHERE i."orgId"=o.id) AS "invoiceCount"',
  'FROM "BillingCustomer" c',
  'JOIN "Organization" o ON o.id=c."orgId"',
  'LEFT JOIN "BillingOrgState" state ON state."orgId"=o.id',
  "WHERE c.provider='STRIPE'::\"BillingProvider\"",
  'ORDER BY state."lastSyncedAt" ASC NULLS FIRST,c."updatedAt" ASC',
  "LIMIT 100",
].join(" ");

export async function getCommerceBillingReadiness() {
  const db = getDb();

  const [ledgerResult, organizationsResult, reconciliationWorker] =
    await Promise.all([
      db.query<{
        customerCount: number;
        orgStateCount: number;
        subscriptionCount: number;
        invoiceCount: number;
        webhookEventCount: number;
        projectionCount: number;
        processedWebhookCount: number;
        ignoredWebhookCount: number;
        failedWebhookCount: number;
        stalledWebhookCount: number;
        unmappedIgnoredCount: number;
        latestWebhookAt: Date | string | null;
        latestSyncAt: Date | string | null;
      }>(LEDGER_SQL),
      db.query<{
        orgId: string;
        orgName: string;
        orgSlug: string;
        customerMappedAt: Date | string;
        customerUpdatedAt: Date | string;
        lastSyncedAt: Date | string | null;
        subscriptionCount: number;
        invoiceCount: number;
      }>(ORGANIZATIONS_SQL),
      readBillingReconciliationHeartbeat(),
    ]);

  const ledger = ledgerResult.rows[0] ?? {
    customerCount: 0,
    orgStateCount: 0,
    subscriptionCount: 0,
    invoiceCount: 0,
    webhookEventCount: 0,
    projectionCount: 0,
    processedWebhookCount: 0,
    ignoredWebhookCount: 0,
    failedWebhookCount: 0,
    stalledWebhookCount: 0,
    unmappedIgnoredCount: 0,
    latestWebhookAt: null,
    latestSyncAt: null,
  };

  const staleAfterMs = staleReconciliationAfterMs();
  const organizations = organizationsResult.rows.map((row) => {
    const lastSyncedAt = asIso(row.lastSyncedAt);
    const lastSyncedMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
    const syncState = !lastSyncedAt
      ? ("never_synced" as const)
      : Date.now() - lastSyncedMs > staleAfterMs
        ? ("stale" as const)
        : ("synced" as const);

    return {
      orgId: row.orgId,
      orgName: row.orgName,
      orgSlug: row.orgSlug,
      customerMappedAt: asIso(row.customerMappedAt),
      lastSyncedAt,
      subscriptionCount: asNumber(row.subscriptionCount),
      invoiceCount: asNumber(row.invoiceCount),
      syncState,
    };
  });

  const issues: BillingReadinessIssue[] = [];
  const billingEnabled = process.env.STRIPE_BILLING_ENABLED === "true";
  const processorSecretConfigured = configured(process.env.STRIPE_SECRET_KEY);
  const webhookSecretConfigured = configured(process.env.STRIPE_WEBHOOK_SECRET);
  const endpointId = process.env.STRIPE_CANONICAL_WEBHOOK_ENDPOINT_ID?.trim();
  const configuredUrl =
    process.env.STRIPE_CANONICAL_WEBHOOK_URL?.trim() ??
    CANONICAL_STRIPE_WEBHOOK_URL;

  if (!billingEnabled) {
    issues.push({
      code: "billing_disabled",
      severity: "critical",
      title: "Stripe billing is disabled",
      detail: "STRIPE_BILLING_ENABLED is not true on the Platform API.",
    });
  }
  if (!processorSecretConfigured) {
    issues.push({
      code: "processor_secret_missing",
      severity: "critical",
      title: "Stripe API credential is missing",
      detail: "The Platform API cannot inspect or reconcile processor state.",
    });
  }
  if (!webhookSecretConfigured) {
    issues.push({
      code: "webhook_secret_missing",
      severity: "critical",
      title: "Webhook signing secret is missing",
      detail:
        "Signed Stripe events cannot enter the canonical billing pipeline.",
    });
  }
  if (!endpointId) {
    issues.push({
      code: "endpoint_id_missing",
      severity: "critical",
      title: "Canonical Stripe endpoint ID is not pinned",
      detail:
        "STRIPE_CANONICAL_WEBHOOK_ENDPOINT_ID is missing, so endpoint drift cannot be verified.",
    });
  }
  if (configuredUrl !== CANONICAL_STRIPE_WEBHOOK_URL) {
    issues.push({
      code: "configured_url_drift",
      severity: "critical",
      title: "Canonical webhook URL configuration drift",
      detail:
        "The configured public webhook URL does not match the MigraTeck canonical billing route.",
    });
  }

  let endpoint = {
    checked: false,
    exists: false,
    enabled: false,
    matchesExpectedUrl: false,
    matchesExpectedApiVersion: false,
    status: null as string | null,
    apiVersion: null as string | null,
    createdAt: null as string | null,
    enabledEventCount: 0,
    requiredEventCount: CANONICAL_STRIPE_WEBHOOK_EVENTS.length,
    missingEvents: [...CANONICAL_STRIPE_WEBHOOK_EVENTS] as string[],
  };

  let processor = {
    checked: false,
    recentEventSampleCount: 0,
    sampleComplete: false,
    latestEventAt: null as string | null,
    relevantEventsSinceEndpointCreation: 0,
    locallyObservedRelevantEvents: 0,
    missingLocalDeliveries: 0,
    deliveryState: "unverified" as
      | "unverified"
      | "awaiting_first_event"
      | "observed"
      | "delivery_gap",
  };

  if (processorSecretConfigured && endpointId) {
    try {
      const stripe = stripeClient();
      const remoteEndpoint = await stripe.webhookEndpoints.retrieve(endpointId);
      const enabledEvents = new Set(remoteEndpoint.enabled_events);
      const missingEvents = CANONICAL_STRIPE_WEBHOOK_EVENTS.filter(
        (event) => !enabledEvents.has(event),
      );

      endpoint = {
        checked: true,
        exists: true,
        enabled: remoteEndpoint.status === "enabled",
        matchesExpectedUrl: remoteEndpoint.url === CANONICAL_STRIPE_WEBHOOK_URL,
        matchesExpectedApiVersion:
          remoteEndpoint.api_version === CANONICAL_STRIPE_WEBHOOK_API_VERSION,
        status: remoteEndpoint.status,
        apiVersion: remoteEndpoint.api_version ?? null,
        createdAt: new Date(remoteEndpoint.created * 1000).toISOString(),
        enabledEventCount: remoteEndpoint.enabled_events.length,
        requiredEventCount: CANONICAL_STRIPE_WEBHOOK_EVENTS.length,
        missingEvents,
      };

      if (!endpoint.enabled) {
        issues.push({
          code: "endpoint_disabled",
          severity: "critical",
          title: "Canonical Stripe endpoint is disabled",
          detail: "Stripe will not deliver billing events to the Platform API.",
        });
      }
      if (!endpoint.matchesExpectedUrl) {
        issues.push({
          code: "endpoint_url_drift",
          severity: "critical",
          title: "Stripe endpoint URL drift",
          detail:
            "The pinned Stripe endpoint no longer targets the canonical MigraTeck billing route.",
        });
      }
      if (!endpoint.matchesExpectedApiVersion) {
        issues.push({
          code: "endpoint_api_version_drift",
          severity: "critical",
          title: "Stripe webhook API version drift",
          detail:
            "The canonical endpoint is not rendering events with the pinned Stripe API version.",
        });
      }
      if (missingEvents.length) {
        issues.push({
          code: "endpoint_event_gap",
          severity: "critical",
          title: "Stripe event coverage is incomplete",
          detail:
            missingEvents.length +
            " required canonical billing event type(s) are not enabled.",
        });
      }

      const recentEvents = await stripe.events.list({ limit: 100 });
      const endpointCreatedAt = remoteEndpoint.created;
      const relevant = recentEvents.data.filter(
        (event) =>
          event.created >= endpointCreatedAt && enabledEvents.has(event.type),
      );

      const relevantIds = relevant.map((event) => event.id);
      let locallyObserved = 0;
      if (relevantIds.length) {
        const local = await db.query<{ eventId: string }>(
          'SELECT "eventId" FROM "BillingWebhookEvent" WHERE "eventId"=ANY($1::text[])',
          [relevantIds],
        );
        locallyObserved = new Set(local.rows.map((row) => row.eventId)).size;
      }

      const missingLocalDeliveries = Math.max(
        0,
        relevant.length - locallyObserved,
      );
      const latestProcessorEvent = recentEvents.data[0] ?? null;

      processor = {
        checked: true,
        recentEventSampleCount: recentEvents.data.length,
        sampleComplete: !recentEvents.has_more,
        latestEventAt: latestProcessorEvent
          ? new Date(latestProcessorEvent.created * 1000).toISOString()
          : null,
        relevantEventsSinceEndpointCreation: relevant.length,
        locallyObservedRelevantEvents: locallyObserved,
        missingLocalDeliveries,
        deliveryState:
          relevant.length === 0
            ? "awaiting_first_event"
            : missingLocalDeliveries > 0
              ? "delivery_gap"
              : "observed",
      };

      if (missingLocalDeliveries > 0) {
        issues.push({
          code: "processor_delivery_gap",
          severity: "critical",
          title: "Stripe events are missing from the canonical ledger",
          detail:
            missingLocalDeliveries +
            " relevant processor event(s) emitted after endpoint creation are not present locally.",
        });
      }
    } catch (error) {
      endpoint = {
        ...endpoint,
        checked: true,
      };
      processor = {
        ...processor,
        checked: true,
      };
      issues.push({
        code: "processor_probe_failed",
        severity: "critical",
        title: "Stripe readiness probe failed",
        detail:
          error instanceof Error
            ? error.message.slice(0, 240)
            : "Unable to inspect the canonical Stripe endpoint.",
      });
    }
  }

  const neverSynced = organizations.filter(
    (organization) => organization.syncState === "never_synced",
  ).length;
  const staleReconciliations = organizations.filter(
    (organization) => organization.syncState === "stale",
  ).length;

  if (!reconciliationWorker.live) {
    issues.push({
      code: "reconciliation_worker_unavailable",
      severity: "warning",
      title: "Billing reconciliation worker is not live",
      detail:
        "The periodic Stripe reconciliation safety net does not have a fresh heartbeat.",
    });
  }

  if (staleReconciliations > 0) {
    issues.push({
      code: "mapped_customer_stale_reconciliation",
      severity: "warning",
      title: "Mapped billing organizations have stale reconciliation",
      detail:
        staleReconciliations +
        " mapped organization(s) have not been reconciled within the freshness window.",
    });
  }

  if (neverSynced > 0) {
    issues.push({
      code: "mapped_customer_never_reconciled",
      severity: "warning",
      title: "Mapped billing organizations need reconciliation",
      detail:
        neverSynced +
        " mapped organization(s) do not have canonical BillingOrgState sync evidence.",
    });
  }

  if (asNumber(ledger.failedWebhookCount) > 0) {
    issues.push({
      code: "failed_webhook_events",
      severity: "critical",
      title: "Failed canonical Stripe events",
      detail:
        asNumber(ledger.failedWebhookCount) +
        " webhook event(s) are currently marked FAILED.",
    });
  }

  if (asNumber(ledger.stalledWebhookCount) > 0) {
    issues.push({
      code: "stalled_webhook_events",
      severity: "warning",
      title: "Stalled canonical Stripe events",
      detail:
        asNumber(ledger.stalledWebhookCount) +
        " webhook event(s) have remained in-flight for more than 10 minutes.",
    });
  }

  if (asNumber(ledger.unmappedIgnoredCount) > 0) {
    issues.push({
      code: "unmapped_stripe_customer_events",
      severity: "warning",
      title: "Stripe events reference unmapped customers",
      detail:
        asNumber(ledger.unmappedIgnoredCount) +
        " ignored webhook event(s) referenced Stripe customers with no platform organization mapping.",
    });
  }

  if (
    asNumber(ledger.processedWebhookCount) > asNumber(ledger.projectionCount)
  ) {
    issues.push({
      code: "projection_gap",
      severity: "critical",
      title: "Processed webhook projection gap",
      detail:
        "Canonical webhook rows marked PROCESSED exceed durable BillingEventProjection evidence.",
    });
  }

  const criticalCount = issues.filter(
    (issue) => issue.severity === "critical",
  ).length;
  const warningCount = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;

  return {
    checkedAt: new Date().toISOString(),
    overall:
      criticalCount > 0
        ? ("blocked" as const)
        : warningCount > 0
          ? ("degraded" as const)
          : ("ready" as const),
    summary: {
      critical: criticalCount,
      warning: warningCount,
    },
    configuration: {
      billingEnabled,
      processorSecretConfigured,
      webhookSecretConfigured,
      endpointIdConfigured: Boolean(endpointId),
      expectedUrl: CANONICAL_STRIPE_WEBHOOK_URL,
      configuredUrl,
    },
    endpoint,
    processor,
    reconciliationWorker: {
      ...reconciliationWorker,
      staleAfterMs,
    },
    ledger: {
      customerCount: asNumber(ledger.customerCount),
      orgStateCount: asNumber(ledger.orgStateCount),
      subscriptionCount: asNumber(ledger.subscriptionCount),
      invoiceCount: asNumber(ledger.invoiceCount),
      webhookEventCount: asNumber(ledger.webhookEventCount),
      projectionCount: asNumber(ledger.projectionCount),
      processedWebhookCount: asNumber(ledger.processedWebhookCount),
      ignoredWebhookCount: asNumber(ledger.ignoredWebhookCount),
      failedWebhookCount: asNumber(ledger.failedWebhookCount),
      stalledWebhookCount: asNumber(ledger.stalledWebhookCount),
      unmappedIgnoredCount: asNumber(ledger.unmappedIgnoredCount),
      latestWebhookAt: asIso(ledger.latestWebhookAt),
      latestSyncAt: asIso(ledger.latestSyncAt),
      neverSyncedMappedOrganizations: neverSynced,
      staleMappedOrganizations: staleReconciliations,
    },
    organizations,
    issues,
  };
}

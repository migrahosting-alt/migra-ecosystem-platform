
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getDb } from "./db.js";

let stripeClient: Stripe | null = null;

function stripe(): Stripe {
  if (stripeClient) return stripeClient;

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw Object.assign(new Error("Stripe processor is not configured"), {
      statusCode: 503,
    });
  }

  stripeClient = new Stripe(key, {
    apiVersion: "2025-04-30.basil" as Stripe.LatestApiVersion,
    typescript: true,
  });
  return stripeClient;
}

function unixDate(value: number | null | undefined): Date | null {
  return typeof value === "number" && value > 0
    ? new Date(value * 1000)
    : null;
}

function normalizedSubscriptionStatus(subscription: Stripe.Subscription): string {
  if (subscription.pause_collection) return "PAUSED";
  return subscription.status.toUpperCase();
}

function subscriptionCustomerId(subscription: Stripe.Subscription): string | null {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id ?? null;
}

function sanitizeSubscription(subscription: Stripe.Subscription) {
  return {
    id: subscription.id,
    customerId: subscriptionCustomerId(subscription),
    status: normalizedSubscriptionStatus(subscription),
    stripeStatus: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodStart:
      unixDate(subscription.current_period_start)?.toISOString() ?? null,
    currentPeriodEnd:
      unixDate(subscription.current_period_end)?.toISOString() ?? null,
    trialEnd: unixDate(subscription.trial_end)?.toISOString() ?? null,
    canceledAt: unixDate(subscription.canceled_at)?.toISOString() ?? null,
    pauseCollection: subscription.pause_collection
      ? {
          behavior: subscription.pause_collection.behavior,
          resumesAt:
            unixDate(subscription.pause_collection.resumes_at)?.toISOString() ??
            null,
        }
      : null,
    metadata: subscription.metadata,
    items: subscription.items.data.map((item) => ({
      id: item.id,
      priceId: item.price?.id ?? null,
      lookupKey: item.price?.lookup_key ?? null,
      quantity: item.quantity ?? null,
      metadata: item.metadata,
    })),
  };
}

function sanitizeInvoice(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id ?? null;

  return {
    id: invoice.id,
    customerId,
    number: invoice.number ?? null,
    status: invoice.status ?? "unknown",
    currency: invoice.currency,
    subtotal: invoice.subtotal ?? 0,
    tax: (invoice.total_tax_amounts ?? []).reduce(
      (sum, item) => sum + item.amount,
      0,
    ),
    total: invoice.total ?? 0,
    amountPaid: invoice.amount_paid ?? 0,
    amountRemaining: invoice.amount_remaining ?? 0,
    periodStart: unixDate(invoice.period_start)?.toISOString() ?? null,
    periodEnd: unixDate(invoice.period_end)?.toISOString() ?? null,
    finalizedAt:
      unixDate(invoice.status_transitions?.finalized_at)?.toISOString() ?? null,
    paidAt:
      unixDate(invoice.status_transitions?.paid_at)?.toISOString() ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    metadata: invoice.metadata,
  };
}

type ProcessorBundle = {
  configured: true;
  completeness: {
    subscriptions: boolean;
    invoices: boolean;
    paymentMethods: boolean;
  };
  customer: {
    id: string;
    email: string | null;
    name: string | null;
    balance: number;
    delinquent: boolean | null;
    defaultPaymentMethodId: string | null;
  };
  subscriptions: ReturnType<typeof sanitizeSubscription>[];
  invoices: ReturnType<typeof sanitizeInvoice>[];
  paymentMethods: Array<{
    id: string;
    type: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
  }>;
};

async function loadAllSubscriptions(
  client: Stripe,
  customerId: string,
  maxItems = 1000,
): Promise<{ data: Stripe.Subscription[]; complete: boolean }> {
  const data: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;

  while (data.length < maxItems) {
    const page = await client.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: Math.min(100, maxItems - data.length),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    data.push(...page.data);

    if (!page.has_more) return { data, complete: true };
    const last = page.data.at(-1);
    if (!last) return { data, complete: false };
    startingAfter = last.id;
  }

  return { data, complete: false };
}

async function loadAllInvoices(
  client: Stripe,
  customerId: string,
  maxItems = 5000,
): Promise<{ data: Stripe.Invoice[]; complete: boolean }> {
  const data: Stripe.Invoice[] = [];
  let startingAfter: string | undefined;

  while (data.length < maxItems) {
    const page = await client.invoices.list({
      customer: customerId,
      limit: Math.min(100, maxItems - data.length),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    data.push(...page.data);

    if (!page.has_more) return { data, complete: true };
    const last = page.data.at(-1);
    if (!last) return { data, complete: false };
    startingAfter = last.id;
  }

  return { data, complete: false };
}

async function loadAllPaymentMethods(
  client: Stripe,
  customerId: string,
  maxItems = 500,
): Promise<{ data: Stripe.PaymentMethod[]; complete: boolean }> {
  const data: Stripe.PaymentMethod[] = [];
  let startingAfter: string | undefined;

  while (data.length < maxItems) {
    const page = await client.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: Math.min(100, maxItems - data.length),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    data.push(...page.data);

    if (!page.has_more) return { data, complete: true };
    const last = page.data.at(-1);
    if (!last) return { data, complete: false };
    startingAfter = last.id;
  }

  return { data, complete: false };
}

async function loadProcessorBundle(customerId: string): Promise<ProcessorBundle> {
  const client = stripe();

  const [customer, subscriptions, invoices, paymentMethods] =
    await Promise.all([
      client.customers.retrieve(customerId),
      loadAllSubscriptions(client, customerId),
      loadAllInvoices(client, customerId),
      loadAllPaymentMethods(client, customerId),
    ]);

  if ("deleted" in customer && customer.deleted) {
    throw Object.assign(new Error("Stripe customer has been deleted"), {
      statusCode: 409,
    });
  }

  const defaultMethod = customer.invoice_settings?.default_payment_method;
  const defaultPaymentMethodId =
    typeof defaultMethod === "string"
      ? defaultMethod
      : defaultMethod?.id ?? null;

  return {
    configured: true,
    completeness: {
      subscriptions: subscriptions.complete,
      invoices: invoices.complete,
      paymentMethods: paymentMethods.complete,
    },
    customer: {
      id: customer.id,
      email: customer.email ?? null,
      name: customer.name ?? null,
      balance: customer.balance ?? 0,
      delinquent: customer.delinquent ?? null,
      defaultPaymentMethodId,
    },
    subscriptions: subscriptions.data.map(sanitizeSubscription),
    invoices: invoices.data.map(sanitizeInvoice),
    paymentMethods: paymentMethods.data.map((method) => ({
      id: method.id,
      type: method.type,
      brand: method.card?.brand ?? null,
      last4: method.card?.last4 ?? null,
      expMonth: method.card?.exp_month ?? null,
      expYear: method.card?.exp_year ?? null,
    })),
  };
}

function buildDriftReport(input: {
  localCustomerEmail: string | null;
  localSubscriptions: Array<{
    externalSubscriptionId: string;
    status: string;
  }>;
  localInvoices: Array<{
    stripeInvoiceId: string;
    status: string;
  }>;
  processor: ProcessorBundle | null;
}) {
  if (!input.processor) {
    return {
      checked: false,
      complete: false,
      healthy: null,
      emailMismatch: false,
      missingLocalSubscriptions: [] as string[],
      orphanedLocalSubscriptions: [] as string[],
      subscriptionStatusMismatches: [] as Array<{
        id: string;
        local: string;
        processor: string;
      }>,
      missingLocalInvoices: [] as string[],
      orphanedLocalInvoices: [] as string[],
      invoiceStatusMismatches: [] as Array<{
        id: string;
        local: string;
        processor: string;
      }>,
    };
  }

  const processorSubscriptions = new Map(
    input.processor.subscriptions.map((item) => [item.id, item]),
  );
  const localSubscriptions = new Map(
    input.localSubscriptions.map((item) => [item.externalSubscriptionId, item]),
  );
  const processorInvoices = new Map(
    input.processor.invoices.map((item) => [item.id, item]),
  );
  const localInvoices = new Map(
    input.localInvoices.map((item) => [item.stripeInvoiceId, item]),
  );

  const missingLocalSubscriptions = [...processorSubscriptions.keys()].filter(
    (id) => !localSubscriptions.has(id),
  );
  const orphanedLocalSubscriptions =
    input.processor.completeness.subscriptions
      ? [...localSubscriptions.keys()].filter(
          (id) => !processorSubscriptions.has(id),
        )
      : [];
  const subscriptionStatusMismatches = [...processorSubscriptions.entries()]
    .filter(([id, remote]) => {
      const local = localSubscriptions.get(id);
      return local && local.status !== remote.status;
    })
    .map(([id, remote]) => ({
      id,
      local: localSubscriptions.get(id)!.status,
      processor: remote.status,
    }));

  const missingLocalInvoices = [...processorInvoices.keys()].filter(
    (id) => !localInvoices.has(id),
  );
  const orphanedLocalInvoices =
    input.processor.completeness.invoices
      ? [...localInvoices.keys()].filter((id) => !processorInvoices.has(id))
      : [];
  const invoiceStatusMismatches = [...processorInvoices.entries()]
    .filter(([id, remote]) => {
      const local = localInvoices.get(id);
      return (
        local &&
        local.status.toLowerCase() !== remote.status.toLowerCase()
      );
    })
    .map(([id, remote]) => ({
      id,
      local: localInvoices.get(id)!.status,
      processor: remote.status,
    }));

  const emailMismatch =
    Boolean(input.localCustomerEmail) &&
    Boolean(input.processor.customer.email) &&
    input.localCustomerEmail!.toLowerCase() !==
      input.processor.customer.email!.toLowerCase();

  const complete =
    input.processor.completeness.subscriptions &&
    input.processor.completeness.invoices;
  const healthy = complete
    ? !emailMismatch &&
      missingLocalSubscriptions.length === 0 &&
      orphanedLocalSubscriptions.length === 0 &&
      subscriptionStatusMismatches.length === 0 &&
      missingLocalInvoices.length === 0 &&
      orphanedLocalInvoices.length === 0 &&
      invoiceStatusMismatches.length === 0
    : null;

  return {
    checked: true,
    complete,
    healthy,
    emailMismatch,
    missingLocalSubscriptions,
    orphanedLocalSubscriptions,
    subscriptionStatusMismatches,
    missingLocalInvoices,
    orphanedLocalInvoices,
    invoiceStatusMismatches,
  };
}

export async function getBillingOperationsOverview(
  query = "",
  limit = 50,
) {
  const db = getDb();
  const normalized = query.trim();

  const metricsSql = [
    "SELECT",
    "(SELECT count(*)::int FROM \"BillingCustomer\") AS customers,",
    "(SELECT count(*)::int FROM \"BillingSubscription\") AS subscriptions,",
    "(SELECT count(*)::int FROM \"BillingSubscription\" WHERE status IN ('ACTIVE','TRIALING')) AS \"activeSubscriptions\",",
    "(SELECT count(*)::int FROM \"BillingInvoice\") AS invoices,",
    "(SELECT count(*)::int FROM \"BillingInvoice\" WHERE lower(status) IN ('open','uncollectible')) AS \"openInvoices\",",
    "(SELECT COALESCE(sum(\"amountRemaining\"),0)::bigint FROM \"BillingInvoice\" WHERE \"amountRemaining\">0) AS \"amountOutstanding\",",
    "(SELECT count(*)::int FROM \"BillingWebhookEvent\" WHERE status='FAILED') AS \"failedWebhookEvents\",",
    "(SELECT count(*)::int FROM \"BillingWebhookEvent\" WHERE status IN ('RECEIVED','QUEUED','PROCESSING')) AS \"pendingWebhookEvents\",",
    "(SELECT count(*)::int FROM \"BillingOrgState\") AS \"orgStates\"",
  ].join(" ");

  const organizationsSql = [
    "SELECT",
    "o.id,o.name,o.slug,",
    "c.id AS \"billingCustomerId\",",
    "c.\"externalCustomerId\",",
    "c.email AS \"billingEmail\",",
    "c.\"updatedAt\" AS \"customerUpdatedAt\",",
    "(SELECT count(*)::int FROM \"BillingSubscription\" s WHERE s.\"orgId\"=o.id) AS \"subscriptionCount\",",
    "(SELECT count(*)::int FROM \"BillingSubscription\" s WHERE s.\"orgId\"=o.id AND s.status IN ('ACTIVE','TRIALING')) AS \"activeSubscriptionCount\",",
    "(SELECT count(*)::int FROM \"BillingInvoice\" i WHERE i.\"orgId\"=o.id) AS \"invoiceCount\",",
    "(SELECT COALESCE(sum(i.\"amountRemaining\"),0)::bigint FROM \"BillingInvoice\" i WHERE i.\"orgId\"=o.id AND i.\"amountRemaining\">0) AS \"amountOutstanding\",",
    "(SELECT max(i.\"updatedAt\") FROM \"BillingInvoice\" i WHERE i.\"orgId\"=o.id) AS \"invoiceUpdatedAt\",",
    "(SELECT max(s.\"updatedAt\") FROM \"BillingSubscription\" s WHERE s.\"orgId\"=o.id) AS \"subscriptionUpdatedAt\",",
    "state.standing,state.\"lastSyncedAt\"",
    "FROM \"Organization\" o",
    "LEFT JOIN \"BillingCustomer\" c ON c.\"orgId\"=o.id",
    "LEFT JOIN \"BillingOrgState\" state ON state.\"orgId\"=o.id",
    "WHERE ($1='' OR position(lower($1) in lower(o.name))>0 OR position(lower($1) in lower(o.slug))>0 OR position(lower($1) in lower(COALESCE(c.email,'')))>0 OR position(lower($1) in lower(COALESCE(c.\"externalCustomerId\",'')))>0)",
    "ORDER BY CASE WHEN c.id IS NOT NULL THEN 0 ELSE 1 END,\"activeSubscriptionCount\" DESC,o.\"createdAt\" DESC",
    "LIMIT $2",
  ].join(" ");

  const webhookSql = [
    "SELECT status::text AS status,count(*)::int AS count,max(\"receivedAt\") AS \"latestAt\"",
    "FROM \"BillingWebhookEvent\"",
    "GROUP BY status",
    "ORDER BY status",
  ].join(" ");

  const [metrics, organizations, webhookHealth] = await Promise.all([
    db.query(metricsSql),
    db.query(organizationsSql, [
      normalized,
      Math.min(Math.max(limit, 1), 100),
    ]),
    db.query(webhookSql),
  ]);

  const row = metrics.rows[0] ?? {};
  return {
    metrics: {
      customers: Number(row.customers ?? 0),
      subscriptions: Number(row.subscriptions ?? 0),
      activeSubscriptions: Number(row.activeSubscriptions ?? 0),
      invoices: Number(row.invoices ?? 0),
      openInvoices: Number(row.openInvoices ?? 0),
      amountOutstanding: Number(row.amountOutstanding ?? 0),
      failedWebhookEvents: Number(row.failedWebhookEvents ?? 0),
      pendingWebhookEvents: Number(row.pendingWebhookEvents ?? 0),
      orgStates: Number(row.orgStates ?? 0),
    },
    processorConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    organizations: organizations.rows,
    webhookHealth: webhookHealth.rows,
  };
}

export async function getOrganizationBillingOperations(orgId: string) {
  const db = getDb();

  const [
    org,
    customer,
    subscriptions,
    invoices,
    taxProfile,
    orgState,
    entitlements,
    projections,
  ] = await Promise.all([
    db.query(
      'SELECT id,name,slug,"authOrganizationId","isMigraHostingClient","createdAt","updatedAt" FROM "Organization" WHERE id=$1',
      [orgId],
    ),
    db.query(
      'SELECT id,"orgId",provider::text AS provider,"externalCustomerId",email,metadata,"stripeAccountId","resellerPartnerId","createdAt","updatedAt" FROM "BillingCustomer" WHERE "orgId"=$1 ORDER BY "updatedAt" DESC LIMIT 1',
      [orgId],
    ),
    db.query(
      'SELECT id,"orgId",provider::text AS provider,"externalSubscriptionId","externalCustomerId",status::text AS status,"currentPeriodStart","currentPeriodEnd","cancelAtPeriodEnd","canceledAt",metadata,"createdAt","updatedAt" FROM "BillingSubscription" WHERE "orgId"=$1 ORDER BY "createdAt" DESC',
      [orgId],
    ),
    db.query(
      'SELECT id,"orgId","stripeInvoiceId","stripeAccountId",number,status,currency,subtotal,tax,total,"amountPaid","amountRemaining","periodStart","periodEnd","hostedInvoiceUrl","invoicePdfUrl","finalizedAt","paidAt",metadata,"createdAt","updatedAt" FROM "BillingInvoice" WHERE "orgId"=$1 ORDER BY "createdAt" DESC LIMIT 100',
      [orgId],
    ),
    db.query(
      'SELECT id,"orgId","legalName","billingEmail",country,"stateRegion",city,"postalCode","addressLine1","addressLine2","taxIdType","taxIdValue","isBusiness","stripeTaxExempt",metadata,"createdAt","updatedAt" FROM "BillingTaxProfile" WHERE "orgId"=$1 LIMIT 1',
      [orgId],
    ),
    db.query(
      'SELECT id,"orgId","stripeCustomerId","stripeSubscriptionId","subscriptionStatus","latestInvoiceId","latestInvoiceStatus",standing,"entitlementsVersion","lastStripeEventId","lastStripeEventType","lastSyncedAt","graceEndsAt","restrictedAt","suspendedAt",metadata,"createdAt","updatedAt" FROM "BillingOrgState" WHERE "orgId"=$1 LIMIT 1',
      [orgId],
    ),
    db.query(
      'SELECT id,product::text AS product,status::text AS status,"startsAt","endsAt",notes,"createdAt","updatedAt" FROM "OrgEntitlement" WHERE "orgId"=$1 ORDER BY product',
      [orgId],
    ),
    db.query(
      [
        'SELECT p.id,p."projectionType",p."projectionRef",',
        'p.status AS "projectionStatus",p.metadata AS "projectionMetadata",',
        'p."createdAt" AS "projectedAt",w."eventId",w."eventType",',
        'w.status::text AS "eventStatus",w.reason,w.attempts,w."errorText",',
        'w."receivedAt",w."processedAt"',
        'FROM "BillingEventProjection" p',
        'JOIN "BillingWebhookEvent" w ON w.id=p."webhookEventId"',
        'WHERE p."orgId"=$1',
        'ORDER BY p."createdAt" DESC LIMIT 50',
      ].join(" "),
      [orgId],
    ),
  ]);

  const organization = org.rows[0];
  if (!organization) {
    throw Object.assign(new Error("Organization not found"), {
      statusCode: 404,
    });
  }

  const billingCustomer = customer.rows[0] ?? null;
  let processor: ProcessorBundle | null = null;
  let processorError: string | null = null;

  if (billingCustomer?.externalCustomerId) {
    try {
      processor = await loadProcessorBundle(billingCustomer.externalCustomerId);
    } catch {
      processorError = "Stripe customer state could not be loaded.";
    }
  }

  return {
    organization,
    customer: billingCustomer,
    subscriptions: subscriptions.rows,
    invoices: invoices.rows,
    taxProfile: taxProfile.rows[0] ?? null,
    orgState: orgState.rows[0] ?? null,
    entitlements: entitlements.rows,
    eventProjections: projections.rows,
    processor: processor
      ? { ...processor, error: null }
      : {
          configured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
          customer: null,
          subscriptions: [],
          invoices: [],
          paymentMethods: [],
          error: processorError,
        },
    drift: buildDriftReport({
      localCustomerEmail: billingCustomer?.email ?? null,
      localSubscriptions: subscriptions.rows,
      localInvoices: invoices.rows,
      processor,
    }),
  };
}

async function audit(input: {
  actorId: string;
  orgId: string;
  action: string;
  entityType: string;
  entityId: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await getDb().query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())',
    [
      randomUUID(),
      input.actorId,
      input.orgId,
      input.action,
      input.entityType,
      input.entityId,
      input.ip ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function persistProcessorBundle(input: {
  orgId: string;
  customerId: string;
  customerEmail: string | null;
  processor: ProcessorBundle;
  actorId: string;
  operationId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      'UPDATE "BillingCustomer" SET email=$1,"updatedAt"=NOW() WHERE "orgId"=$2 AND provider=\'STRIPE\'::"BillingProvider" AND "externalCustomerId"=$3',
      [input.customerEmail, input.orgId, input.customerId],
    );

    for (const subscription of input.processor.subscriptions) {
      await client.query(
        [
          'INSERT INTO "BillingSubscription"',
          '(id,"orgId",provider,"externalSubscriptionId","externalCustomerId",status,"currentPeriodStart","currentPeriodEnd","cancelAtPeriodEnd","canceledAt",metadata,"createdAt","updatedAt")',
          'VALUES ($1,$2,\'STRIPE\'::"BillingProvider",$3,$4,$5::"BillingSubscriptionStatus",$6,$7,$8,$9,$10::jsonb,NOW(),NOW())',
          'ON CONFLICT ("externalSubscriptionId") DO UPDATE SET',
          '"orgId"=EXCLUDED."orgId","externalCustomerId"=EXCLUDED."externalCustomerId",',
          'status=EXCLUDED.status,"currentPeriodStart"=EXCLUDED."currentPeriodStart",',
          '"currentPeriodEnd"=EXCLUDED."currentPeriodEnd","cancelAtPeriodEnd"=EXCLUDED."cancelAtPeriodEnd",',
          '"canceledAt"=EXCLUDED."canceledAt",metadata=EXCLUDED.metadata,"updatedAt"=NOW()',
        ].join(" "),
        [
          randomUUID(),
          input.orgId,
          subscription.id,
          input.customerId,
          subscription.status,
          subscription.currentPeriodStart
            ? new Date(subscription.currentPeriodStart)
            : null,
          subscription.currentPeriodEnd
            ? new Date(subscription.currentPeriodEnd)
            : null,
          subscription.cancelAtPeriodEnd,
          subscription.canceledAt ? new Date(subscription.canceledAt) : null,
          JSON.stringify({
            stripeStatus: subscription.stripeStatus,
            pauseCollection: subscription.pauseCollection,
            metadata: subscription.metadata,
            items: subscription.items,
          }),
        ],
      );
    }

    for (const invoice of input.processor.invoices) {
      await client.query(
        [
          'INSERT INTO "BillingInvoice"',
          '(id,"orgId","stripeInvoiceId",number,status,currency,subtotal,tax,total,"amountPaid","amountRemaining","periodStart","periodEnd","hostedInvoiceUrl","invoicePdfUrl","finalizedAt","paidAt",metadata,"createdAt","updatedAt")',
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,NOW(),NOW())',
          'ON CONFLICT ("stripeInvoiceId") DO UPDATE SET',
          '"orgId"=EXCLUDED."orgId",number=EXCLUDED.number,status=EXCLUDED.status,',
          'currency=EXCLUDED.currency,subtotal=EXCLUDED.subtotal,tax=EXCLUDED.tax,total=EXCLUDED.total,',
          '"amountPaid"=EXCLUDED."amountPaid","amountRemaining"=EXCLUDED."amountRemaining",',
          '"periodStart"=EXCLUDED."periodStart","periodEnd"=EXCLUDED."periodEnd",',
          '"hostedInvoiceUrl"=EXCLUDED."hostedInvoiceUrl","invoicePdfUrl"=EXCLUDED."invoicePdfUrl",',
          '"finalizedAt"=EXCLUDED."finalizedAt","paidAt"=EXCLUDED."paidAt",',
          'metadata=EXCLUDED.metadata,"updatedAt"=NOW()',
        ].join(" "),
        [
          randomUUID(),
          input.orgId,
          invoice.id,
          invoice.number,
          invoice.status,
          invoice.currency,
          invoice.subtotal,
          invoice.tax,
          invoice.total,
          invoice.amountPaid,
          invoice.amountRemaining,
          invoice.periodStart ? new Date(invoice.periodStart) : null,
          invoice.periodEnd ? new Date(invoice.periodEnd) : null,
          invoice.hostedInvoiceUrl,
          invoice.invoicePdfUrl,
          invoice.finalizedAt ? new Date(invoice.finalizedAt) : null,
          invoice.paidAt ? new Date(invoice.paidAt) : null,
          JSON.stringify(invoice.metadata ?? {}),
        ],
      );
    }

    const preferredSubscription =
      input.processor.subscriptions.find((item) =>
        ["ACTIVE", "TRIALING", "PAST_DUE", "PAUSED"].includes(item.status),
      ) ??
      input.processor.subscriptions[0] ??
      null;
    const latestInvoice = input.processor.invoices[0] ?? null;

    await client.query(
      [
        'INSERT INTO "BillingOrgState"',
        '(id,"orgId","stripeCustomerId","stripeSubscriptionId","subscriptionStatus","latestInvoiceId","latestInvoiceStatus","lastSyncedAt","createdAt","updatedAt")',
        'VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),NOW())',
        'ON CONFLICT ("orgId") DO UPDATE SET',
        '"stripeCustomerId"=EXCLUDED."stripeCustomerId",',
        '"stripeSubscriptionId"=EXCLUDED."stripeSubscriptionId",',
        '"subscriptionStatus"=EXCLUDED."subscriptionStatus",',
        '"latestInvoiceId"=EXCLUDED."latestInvoiceId",',
        '"latestInvoiceStatus"=EXCLUDED."latestInvoiceStatus",',
        '"lastSyncedAt"=NOW(),"updatedAt"=NOW()',
      ].join(" "),
      [
        randomUUID(),
        input.orgId,
        input.customerId,
        preferredSubscription?.id ?? null,
        preferredSubscription?.status ?? null,
        latestInvoice?.id ?? null,
        latestInvoice?.status ?? null,
      ],
    );

    await client.query(
      'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,\'BILLING_RECONCILED\',\'billing_customer\',$4,$5,$6,$7::jsonb,NOW())',
      [
        randomUUID(),
        input.actorId,
        input.orgId,
        input.customerId,
        input.ip ?? null,
        input.userAgent ?? null,
        JSON.stringify({
          operationId: input.operationId,
          reason: input.reason,
          processorSubscriptions: input.processor.subscriptions.length,
          processorInvoices: input.processor.invoices.length,
          processorPaymentMethods: input.processor.paymentMethods.length,
        }),
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileOrganizationBilling(input: {
  orgId: string;
  actorId: string;
  operationId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const customer = await getDb().query(
    'SELECT id,"externalCustomerId",email FROM "BillingCustomer" WHERE "orgId"=$1 AND provider=\'STRIPE\'::"BillingProvider" LIMIT 1',
    [input.orgId],
  );

  const row = customer.rows[0];
  if (!row?.externalCustomerId) {
    throw Object.assign(
      new Error("Organization does not have a Stripe customer mapping"),
      { statusCode: 409 },
    );
  }

  const processor = await loadProcessorBundle(row.externalCustomerId);
  if (
    !processor.completeness.subscriptions ||
    !processor.completeness.invoices
  ) {
    throw Object.assign(
      new Error(
        "Stripe history exceeds the safe reconciliation window. Narrow the account history before reconciling.",
      ),
      { statusCode: 409 },
    );
  }

  await persistProcessorBundle({
    orgId: input.orgId,
    customerId: row.externalCustomerId,
    customerEmail: processor.customer.email ?? row.email ?? null,
    processor,
    actorId: input.actorId,
    operationId: input.operationId,
    reason: input.reason,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  return getOrganizationBillingOperations(input.orgId);
}

export type SubscriptionOperatorAction =
  | "pause_collection"
  | "resume_collection"
  | "cancel_at_period_end"
  | "cancel_immediate";

export async function operateSubscription(input: {
  orgId: string;
  subscriptionId: string;
  action: SubscriptionOperatorAction;
  operationId: string;
  reason: string;
  expectedUpdatedAt?: string | null;
  actorId: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const db = getDb();

  const result = await db.query(
    [
      'SELECT s.id,s."orgId",s."externalSubscriptionId",s."externalCustomerId",',
      's.status::text AS status,s."updatedAt",c."externalCustomerId" AS "mappedCustomerId"',
      'FROM "BillingSubscription" s',
      'LEFT JOIN "BillingCustomer" c ON c."orgId"=s."orgId" AND c.provider=\'STRIPE\'::"BillingProvider"',
      'WHERE s.id=$1 AND s."orgId"=$2 LIMIT 1',
    ].join(" "),
    [input.subscriptionId, input.orgId],
  );

  const local = result.rows[0];
  if (!local) {
    throw Object.assign(new Error("Subscription not found"), {
      statusCode: 404,
    });
  }

  if (
    input.expectedUpdatedAt &&
    new Date(local.updatedAt).toISOString() !==
      new Date(input.expectedUpdatedAt).toISOString()
  ) {
    throw Object.assign(
      new Error(
        "Subscription changed since it was loaded. Refresh before acting.",
      ),
      { statusCode: 409 },
    );
  }

  if (
    !local.mappedCustomerId ||
    (local.externalCustomerId &&
      local.externalCustomerId !== local.mappedCustomerId)
  ) {
    throw Object.assign(
      new Error("Subscription customer mapping is inconsistent"),
      { statusCode: 409 },
    );
  }

  const client = stripe();
  const before = await client.subscriptions.retrieve(
    local.externalSubscriptionId,
  );

  if (subscriptionCustomerId(before) !== local.mappedCustomerId) {
    throw Object.assign(
      new Error("Stripe subscription does not belong to this organization"),
      { statusCode: 409 },
    );
  }

  let after: Stripe.Subscription;

  switch (input.action) {
    case "pause_collection":
      after = await client.subscriptions.update(
        before.id,
        { pause_collection: { behavior: "void" } },
        {
          idempotencyKey:
            "migrateck-billing-" + input.operationId + "-" + input.action,
        },
      );
      break;
    case "resume_collection":
      after = await client.subscriptions.update(
        before.id,
        { pause_collection: "" as any },
        {
          idempotencyKey:
            "migrateck-billing-" + input.operationId + "-" + input.action,
        },
      );
      break;
    case "cancel_at_period_end":
      after = await client.subscriptions.update(
        before.id,
        { cancel_at_period_end: true },
        {
          idempotencyKey:
            "migrateck-billing-" + input.operationId + "-" + input.action,
        },
      );
      break;
    case "cancel_immediate":
      after = await client.subscriptions.cancel(
        before.id,
        { prorate: true },
        {
          idempotencyKey:
            "migrateck-billing-" + input.operationId + "-" + input.action,
        },
      );
      break;
  }

  const normalized = sanitizeSubscription(after);

  const localTx = await db.connect();
  try {
    await localTx.query("BEGIN");

    await localTx.query(
      [
        'UPDATE "BillingSubscription"',
        'SET status=$1::"BillingSubscriptionStatus","currentPeriodStart"=$2,',
        '"currentPeriodEnd"=$3,"cancelAtPeriodEnd"=$4,"canceledAt"=$5,',
        'metadata=$6::jsonb,"updatedAt"=NOW()',
        'WHERE id=$7 AND "orgId"=$8',
      ].join(" "),
      [
        normalized.status,
        normalized.currentPeriodStart
          ? new Date(normalized.currentPeriodStart)
          : null,
        normalized.currentPeriodEnd
          ? new Date(normalized.currentPeriodEnd)
          : null,
        normalized.cancelAtPeriodEnd,
        normalized.canceledAt ? new Date(normalized.canceledAt) : null,
        JSON.stringify({
          stripeStatus: normalized.stripeStatus,
          pauseCollection: normalized.pauseCollection,
          metadata: normalized.metadata,
          items: normalized.items,
        }),
        input.subscriptionId,
        input.orgId,
      ],
    );

    await localTx.query(
      'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,\'BILLING_SUBSCRIPTION_OPERATOR_ACTION\',\'billing_subscription\',$4,$5,$6,$7::jsonb,NOW())',
      [
        randomUUID(),
        input.actorId,
        input.orgId,
        input.subscriptionId,
        input.ip ?? null,
        input.userAgent ?? null,
        JSON.stringify({
          action: input.action,
          operationId: input.operationId,
          reason: input.reason,
          externalSubscriptionId: before.id,
          beforeStatus: normalizedSubscriptionStatus(before),
          afterStatus: normalized.status,
          cancelAtPeriodEnd: normalized.cancelAtPeriodEnd,
        }),
      ],
    );

    await localTx.query("COMMIT");
  } catch (error) {
    await localTx.query("ROLLBACK");
    throw error;
  } finally {
    localTx.release();
  }

  return {
    localSubscriptionId: input.subscriptionId,
    subscription: normalized,
  };
}

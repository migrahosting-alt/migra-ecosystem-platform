import type { BillingContext } from "../context";
import type { BillingAdjustment, AdjustmentKind } from "../types";
import type { OrgEntitlements } from "../entitlements/types";
import { resolveAndSnapshotEntitlements } from "../entitlements/index";

// ─── Credits / Adjustments ──────────────────────────────────────────

export interface IssueAdjustmentInput {
  orgId: string;
  kind: AdjustmentKind;
  amount: number;
  currency?: string;
  reason: string;
  createdByUserId: string;
  /** If this should also create a Stripe credit note */
  stripeInvoiceId?: string;
}

/**
 * Issue a billing adjustment (credit, refund, goodwill, service credit, promo).
 * Optionally creates a Stripe credit note against a specific invoice.
 */
export async function issueAdjustment(
  ctx: BillingContext,
  input: IssueAdjustmentInput,
): Promise<BillingAdjustment> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId: input.orgId },
  });
  if (!account) {
    throw new Error(`No billing account for org ${input.orgId}`);
  }

  let stripeCreditNoteId: string | null = null;

  // Create Stripe credit note if tied to an invoice
  if (input.stripeInvoiceId && (input.kind === "credit" || input.kind === "refund")) {
    const creditNote = await ctx.stripe.creditNotes.create({
      invoice: input.stripeInvoiceId,
      amount: input.amount,
      reason: "order_change",
      metadata: {
        org_id: input.orgId,
        kind: input.kind,
        internal_reason: input.reason,
        created_by: input.createdByUserId,
      },
    });
    stripeCreditNoteId = creditNote.id;
  }

  const adjustment = await ctx.db.billingAdjustment.create({
    data: {
      orgId: input.orgId,
      billingAccountId: account.id,
      kind: input.kind.toUpperCase(),
      amount: input.amount,
      currency: input.currency ?? "usd",
      reason: input.reason,
      stripeCreditNoteId,
      createdByUserId: input.createdByUserId,
    },
  });

  return adjustment as BillingAdjustment;
}

// ─── Override Entitlements ───────────────────────────────────────────

export interface OverrideEntitlementsInput {
  orgId: string;
  entitlements: OrgEntitlements;
  reason: string;
  createdByUserId: string;
  expiresAt?: Date;
}

/**
 * Manually override entitlements for an org (admin/support action).
 * Creates a manual_override entitlement snapshot that takes priority.
 */
export async function overrideEntitlements(
  ctx: BillingContext,
  input: OverrideEntitlementsInput,
): Promise<void> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId: input.orgId },
  });
  if (!account) {
    throw new Error(`No billing account for org ${input.orgId}`);
  }

  await ctx.db.billingEntitlementSnapshot.create({
    data: {
      orgId: input.orgId,
      billingAccountId: account.id,
      sourceType: "MANUAL_OVERRIDE",
      sourceId: input.createdByUserId,
      entitlementsJson: input.entitlements as Record<string, unknown>,
      effectiveAt: new Date(),
      expiresAt: input.expiresAt ?? null,
    },
  });

  // Re-resolve entitlements with the new override
  await resolveAndSnapshotEntitlements(ctx, input.orgId);
}

// ─── Reconcile ──────────────────────────────────────────────────────

export interface ReconcileResult {
  orgId: string;
  stripeSubscriptionCount: number;
  platformSubscriptionCount: number;
  entitlementsRefreshed: boolean;
  issues: string[];
}

/**
 * Reconcile an org's billing state between Stripe and platform.
 * Compares Stripe subscriptions with internal mirrors and fixes drift.
 */
export async function reconcileOrg(
  ctx: BillingContext,
  orgId: string,
): Promise<ReconcileResult> {
  const issues: string[] = [];

  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId },
  });

  if (!account?.stripeCustomerId) {
    return {
      orgId,
      stripeSubscriptionCount: 0,
      platformSubscriptionCount: 0,
      entitlementsRefreshed: false,
      issues: ["No billing account or Stripe customer found"],
    };
  }

  // Fetch Stripe subscriptions
  const stripeSubscriptions = await ctx.stripe.subscriptions.list({
    customer: account.stripeCustomerId,
    limit: 100,
  });

  // Fetch platform subscriptions
  const platformSubscriptions = await ctx.db.billingSubscription.findMany({
    where: { orgId },
  });

  // Check for Stripe subscriptions not mirrored locally
  for (const stripeSub of stripeSubscriptions.data) {
    const mirrored = platformSubscriptions.find(
      (ps: any) => ps.stripeSubscriptionId === stripeSub.id,
    );
    if (!mirrored) {
      issues.push(`Stripe subscription ${stripeSub.id} not mirrored locally`);
    }
  }

  // Check for orphaned platform subscriptions
  const stripeIds = new Set(stripeSubscriptions.data.map((s) => s.id));
  for (const ps of platformSubscriptions) {
    if ((ps as any).stripeSubscriptionId && !stripeIds.has((ps as any).stripeSubscriptionId)) {
      issues.push(`Platform subscription ${(ps as any).id} references non-existent Stripe subscription`);
    }
  }

  // Refresh entitlements
  await resolveAndSnapshotEntitlements(ctx, orgId);

  return {
    orgId,
    stripeSubscriptionCount: stripeSubscriptions.data.length,
    platformSubscriptionCount: platformSubscriptions.length,
    entitlementsRefreshed: true,
    issues,
  };
}

// ─── Retry Failed Webhooks ──────────────────────────────────────────

/**
 * Retry all failed webhook events for an org.
 */
export async function retryFailedWebhooks(
  ctx: BillingContext,
  limit?: number,
): Promise<{ retried: number; succeeded: number; failed: number }> {
  const failedEvents = await ctx.db.billingWebhookEvent.findMany({
    where: { status: "FAILED" },
    orderBy: { createdAt: "asc" },
    take: limit ?? 50,
  });

  let succeeded = 0;
  let failed = 0;

  for (const event of failedEvents) {
    try {
      // Re-fetch the event from Stripe
      const stripeEvent = await ctx.stripe.events.retrieve((event as any).stripeEventId);

      // Re-import and process
      const { processWebhookEvent } = await import("../webhooks/index.js");
      const result = await processWebhookEvent(ctx, stripeEvent);

      if (result.status === "processed") {
        succeeded++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { retried: failedEvents.length, succeeded, failed };
}

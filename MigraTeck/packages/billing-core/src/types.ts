// ─── Product Families ───────────────────────────────────────────────
export type ProductFamily =
  | "builder"
  | "hosting"
  | "intake"
  | "invoice"
  | "voice"
  | "email"
  | "marketing"
  | "pilot"
  | "drive";

// ─── Plan Codes ─────────────────────────────────────────────────────
export type PlanCode =
  | "free"
  | "starter"
  | "pro"
  | "business"
  | "enterprise";

// ─── Billing Component Types ────────────────────────────────────────
export type BillingComponentType =
  | "base"
  | "seat"
  | "usage"
  | "onboarding";

// ─── Billing Interval ───────────────────────────────────────────────
export type BillingInterval = "month" | "year";

// ─── Statuses ───────────────────────────────────────────────────────
export type BillingAccountStatus = "active" | "suspended" | "closed";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "paused"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "void"
  | "uncollectible";

export type QuoteStatus =
  | "draft"
  | "open"
  | "accepted"
  | "canceled";

export type DunningState =
  | "active"
  | "past_due"
  | "grace_period"
  | "restricted"
  | "suspended"
  | "canceled";

export type WebhookEventStatus =
  | "pending"
  | "processed"
  | "failed"
  | "skipped";

export type AdjustmentKind =
  | "credit"
  | "service_credit"
  | "goodwill"
  | "refund"
  | "promo";

export type UsageSource =
  | "api"
  | "worker"
  | "system"
  | "manual";

export type EntitlementSourceType =
  | "subscription"
  | "trial"
  | "manual_override"
  | "promotional";

// ─── Data Models ────────────────────────────────────────────────────

export interface BillingAccount {
  id: string;
  orgId: string;
  stripeCustomerId: string | null;
  defaultCurrency: string;
  billingEmail: string | null;
  billingContactName: string | null;
  taxCountry: string | null;
  taxState: string | null;
  taxId: string | null;
  status: BillingAccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingSubscription {
  id: string;
  orgId: string;
  billingAccountId: string;
  stripeSubscriptionId: string | null;
  productFamily: ProductFamily;
  planCode: PlanCode;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  pausedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingSubscriptionItem {
  id: string;
  billingSubscriptionId: string;
  stripeSubscriptionItemId: string | null;
  componentType: BillingComponentType;
  priceLookupKey: string | null;
  quantity: number | null;
  meterName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingInvoice {
  id: string;
  orgId: string;
  stripeInvoiceId: string | null;
  stripeSubscriptionId: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountRemaining: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  issuedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface BillingPaymentMethod {
  id: string;
  orgId: string;
  stripePaymentMethodId: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  createdAt: Date;
}

export interface BillingUsageEvent {
  id: string;
  orgId: string;
  productFamily: ProductFamily;
  meterName: string;
  quantity: number;
  windowStart: Date;
  windowEnd: Date;
  idempotencyKey: string;
  source: UsageSource;
  reportedToStripeAt: Date | null;
  createdAt: Date;
}

export interface BillingEntitlementSnapshot {
  id: string;
  orgId: string;
  sourceType: EntitlementSourceType;
  sourceId: string;
  entitlementsJson: Record<string, unknown>;
  effectiveAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface BillingQuote {
  id: string;
  orgId: string;
  stripeQuoteId: string | null;
  status: QuoteStatus;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
}

export interface BillingWebhookEvent {
  id: string;
  stripeEventId: string;
  type: string;
  processedAt: Date | null;
  status: WebhookEventStatus;
  payloadJson: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: Date;
}

export interface BillingAdjustment {
  id: string;
  orgId: string;
  kind: AdjustmentKind;
  amount: number;
  currency: string;
  reason: string;
  stripeCreditNoteId: string | null;
  createdByUserId: string;
  createdAt: Date;
}

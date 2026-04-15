/**
 * @migrateck/billing-core — Shared enterprise billing platform for the MigraTeck ecosystem.
 *
 * Stripe is the billing engine. MigraTeck is the system of record for provisioning.
 */
export type {
  ProductFamily,
  PlanCode,
  BillingComponentType,
  BillingInterval,
  BillingAccountStatus,
  SubscriptionStatus,
  InvoiceStatus,
  QuoteStatus,
  DunningState,
  WebhookEventStatus,
  AdjustmentKind,
  UsageSource,
  EntitlementSourceType,
} from "./types";

export type {
  BillingAccount,
  BillingSubscription,
  BillingSubscriptionItem,
  BillingInvoice,
  BillingPaymentMethod,
  BillingUsageEvent,
  BillingEntitlementSnapshot,
  BillingQuote,
  BillingWebhookEvent,
  BillingAdjustment,
} from "./types";

export type { EntitlementKey, OrgEntitlements } from "./entitlements/types";

export { createBillingContext, type BillingContext } from "./context";
export { PRODUCT_CATALOG, type CatalogProduct, type CatalogPlan } from "./catalog/index";
export { BILLING_PERMISSIONS, type BillingPermission } from "./permissions";

// ─── Billing Permissions ────────────────────────────────────────────
// Integrated with the MigraTeck platform permission model.

export const BILLING_PERMISSIONS = {
  // Org-level billing
  "billing.account.read": "View billing account details",
  "billing.account.manage": "Update billing account settings",
  "billing.subscription.read": "View subscriptions",
  "billing.subscription.manage": "Create/change/cancel subscriptions",
  "billing.invoice.read": "View invoices",
  "billing.payment_method.manage": "Add/remove payment methods",
  "billing.quote.read": "View quotes",
  "billing.quote.manage": "Create/accept/decline quotes",
  "billing.entitlements.read": "View org entitlements",
  "billing.usage.read": "View usage summaries",
  // Admin/support
  "admin.billing.credits": "Issue credits and adjustments",
  "admin.billing.reconcile": "Run reconciliation tools",
  "admin.billing.override_entitlements": "Override org entitlements",
  "admin.billing.retry_webhooks": "Retry failed webhook events",
} as const;

export type BillingPermission = keyof typeof BILLING_PERMISSIONS;

/**
 * Maps org roles to billing permissions.
 * Follows the MigraTeck role hierarchy: OWNER > ADMIN > BILLING_ADMIN > MEMBER > READONLY
 */
export function deriveBillingPermissions(orgRole: string): BillingPermission[] {
  switch (orgRole.toUpperCase()) {
    case "OWNER":
      return [
        "billing.account.read",
        "billing.account.manage",
        "billing.subscription.read",
        "billing.subscription.manage",
        "billing.invoice.read",
        "billing.payment_method.manage",
        "billing.quote.read",
        "billing.quote.manage",
        "billing.entitlements.read",
        "billing.usage.read",
      ];
    case "ADMIN":
      return [
        "billing.account.read",
        "billing.subscription.read",
        "billing.invoice.read",
        "billing.quote.read",
        "billing.entitlements.read",
        "billing.usage.read",
      ];
    case "BILLING_ADMIN":
      return [
        "billing.account.read",
        "billing.account.manage",
        "billing.subscription.read",
        "billing.subscription.manage",
        "billing.invoice.read",
        "billing.payment_method.manage",
        "billing.quote.read",
        "billing.quote.manage",
        "billing.entitlements.read",
        "billing.usage.read",
      ];
    case "MEMBER":
      return [];
    case "READONLY":
      return ["billing.invoice.read"];
    default:
      return [];
  }
}

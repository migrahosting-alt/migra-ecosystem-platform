import { fetchPlatformApi } from "@/lib/auth/api";

export type BillingAccount = {
  id: string;
  orgId: string;
  status: string;
  billingEmail: string | null;
  billingContactName?: string | null;
  stripeCustomerId: string | null;
  taxCountry?: string | null;
  taxState?: string | null;
  taxId?: string | null;
};

export type BillingSubscription = {
  id: string;
  productFamily: string;
  planCode: string;
  status: string;
  billingInterval: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingInvoice = {
  id: string;
  status: string;
  total: number;
  currency: string;
  issuedAt: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

export type BillingPaymentMethod = {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
};

export type TaxInfo = {
  taxCountry: string | null;
  taxState: string | null;
  taxId: string | null;
};

export type UsageSummaryEntry = {
  productFamily: string;
  meterName: string;
  totalQuantity: number;
  eventCount: number;
};

export type OrgEntitlements = Record<string, string | number | boolean>;

export type CommercialSnapshot = {
  account: BillingAccount | null;
  subscriptions: BillingSubscription[];
  invoices: BillingInvoice[];
  paymentMethods: BillingPaymentMethod[];
  tax: TaxInfo | null;
  entitlements: OrgEntitlements;
  usageSummary: UsageSummaryEntry[];
  dunningState: string;
};

export async function getCommercialSnapshot(orgId?: string | null): Promise<CommercialSnapshot> {
  if (!orgId) {
    return {
      account: null,
      subscriptions: [],
      invoices: [],
      paymentMethods: [],
      tax: null,
      entitlements: {},
      usageSummary: [],
      dunningState: "unknown",
    };
  }

  const [accountRes, subscriptionsRes, invoicesRes, paymentMethodsRes, taxRes, entitlementsRes, usageSummaryRes, dunningRes] = await Promise.all([
    fetchPlatformApi<BillingAccount>("/billing/account", orgId),
    fetchPlatformApi<BillingSubscription[]>("/billing/subscriptions", orgId),
    fetchPlatformApi<BillingInvoice[]>("/billing/invoices", orgId),
    fetchPlatformApi<BillingPaymentMethod[]>("/billing/payment-methods", orgId),
    fetchPlatformApi<TaxInfo>("/billing/tax", orgId),
    fetchPlatformApi<OrgEntitlements>("/billing/entitlements", orgId),
    fetchPlatformApi<UsageSummaryEntry[]>("/billing/usage/summary", orgId),
    fetchPlatformApi<{ dunningState: string }>("/billing/dunning", orgId),
  ]);

  return {
    account: accountRes.ok ? accountRes.data : null,
    subscriptions: subscriptionsRes.ok ? subscriptionsRes.data : [],
    invoices: invoicesRes.ok ? invoicesRes.data : [],
    paymentMethods: paymentMethodsRes.ok ? paymentMethodsRes.data : [],
    tax: taxRes.ok ? taxRes.data : null,
    entitlements: entitlementsRes.ok ? entitlementsRes.data : {},
    usageSummary: usageSummaryRes.ok ? usageSummaryRes.data : [],
    dunningState: dunningRes.ok ? dunningRes.data.dunningState : "unknown",
  };
}

export function getCurrentCommercialPlan(subscriptions: BillingSubscription[]) {
  return subscriptions.find((subscription) => subscription.status === "active" || subscription.status === "trialing") ?? null;
}

export function getNumericEntitlement(entitlements: OrgEntitlements, key: string) {
  const value = entitlements[key];
  return typeof value === "number" ? value : null;
}

export function getBooleanEntitlement(entitlements: OrgEntitlements, key: string) {
  const value = entitlements[key];
  return typeof value === "boolean" ? value : false;
}

export function hasProductAccess(entitlements: OrgEntitlements, family: "builder" | "hosting" | "intake") {
  if (family === "builder") {
    return (getNumericEntitlement(entitlements, "builder.sites.max") ?? 0) !== 0;
  }
  if (family === "hosting") {
    return (getNumericEntitlement(entitlements, "hosting.vps.max") ?? 0) !== 0;
  }
  return (getNumericEntitlement(entitlements, "intake.forms.max") ?? 0) !== 0;
}
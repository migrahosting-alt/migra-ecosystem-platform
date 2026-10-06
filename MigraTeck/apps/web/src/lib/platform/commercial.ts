import { fetchPlatformApi } from "@/lib/auth/api";

type ApiReadResult<T> =
  | { data: T; ok: true }
  | { error: string; status: number; ok: false };

async function readCommercialSource<T>(path: string, orgId: string): Promise<ApiReadResult<T>> {
  try {
    return await fetchPlatformApi<T>(path, orgId, { signal: AbortSignal.timeout(5000) });
  } catch {
    return { error: "Commercial source unavailable", status: 503, ok: false };
  }
}

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
  availability: {
    account: boolean;
    subscriptions: boolean;
    invoices: boolean;
    paymentMethods: boolean;
    tax: boolean;
    entitlements: boolean;
    usageSummary: boolean;
    dunning: boolean;
  };
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
      availability: {
        account: false,
        subscriptions: false,
        invoices: false,
        paymentMethods: false,
        tax: false,
        entitlements: false,
        usageSummary: false,
        dunning: false,
      },
    };
  }

  const [accountRes, subscriptionsRes, invoicesRes, paymentMethodsRes, taxRes, entitlementsRes, usageSummaryRes, dunningRes] = await Promise.all([
    readCommercialSource<BillingAccount>("/billing/account", orgId),
    readCommercialSource<BillingSubscription[]>("/billing/subscriptions", orgId),
    readCommercialSource<BillingInvoice[]>("/billing/invoices", orgId),
    readCommercialSource<BillingPaymentMethod[]>("/billing/payment-methods", orgId),
    readCommercialSource<TaxInfo>("/billing/tax", orgId),
    readCommercialSource<OrgEntitlements>("/billing/entitlements", orgId),
    readCommercialSource<UsageSummaryEntry[]>("/billing/usage/summary", orgId),
    readCommercialSource<{ dunningState: string }>("/billing/dunning", orgId),
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
    availability: {
      account: accountRes.ok,
      subscriptions: subscriptionsRes.ok,
      invoices: invoicesRes.ok,
      paymentMethods: paymentMethodsRes.ok,
      tax: taxRes.ok,
      entitlements: entitlementsRes.ok,
      usageSummary: usageSummaryRes.ok,
      dunning: dunningRes.ok,
    },
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
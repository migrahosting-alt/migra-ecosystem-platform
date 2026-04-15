"use client";

import { useEffect, useState } from "react";
import type {
  BillingAccount,
  BillingInvoice,
  BillingPaymentMethod,
  BillingSubscription,
  OrgEntitlements,
  TaxInfo,
  UsageSummaryEntry,
} from "@/lib/platform/commercial";

type BillingData = {
  account: BillingAccount | null;
  subscriptions: BillingSubscription[];
  invoices: BillingInvoice[];
  paymentMethods: BillingPaymentMethod[];
  tax: TaxInfo | null;
  entitlements: OrgEntitlements;
  usageSummary: UsageSummaryEntry[];
  dunningState: string;
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    trialing: "bg-blue-50 text-blue-700 border-blue-200",
    past_due: "bg-amber-50 text-amber-700 border-amber-200",
    canceled: "bg-slate-100 text-slate-500 border-slate-200",
    unpaid: "bg-red-50 text-red-700 border-red-200",
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    open: "bg-amber-50 text-amber-700 border-amber-200",
    draft: "bg-slate-100 text-slate-500 border-slate-200",
    void: "bg-slate-100 text-slate-400 border-slate-200",
  };
  const cls = colors[status] ?? "bg-slate-100 text-slate-500 border-slate-200";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function entitlementEntries(entitlements: OrgEntitlements) {
  return Object.entries(entitlements)
    .filter(([, value]) => value !== null && value !== false && value !== 0)
    .slice(0, 8);
}

function formatBillingSetupState(status: string | null | undefined, fallback: string) {
  if (!status || status === "unconfigured" || status === "unknown") {
    return fallback;
  }

  return status.replace(/_/g, " ");
}

export function BillingWorkspace() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/platform/billing");
        if (!res.ok) {
          setError("Billing controls are unavailable right now. Refresh sign-in and try again.");
          return;
        }
        setData(await res.json());
      } catch {
        setError("Billing controls are unavailable right now. Refresh sign-in and try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/platform/billing/portal", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.url) {
        window.location.href = body.url;
        return;
      }
      setError(body?.error ?? "Unable to open billing management right now.");
    } catch {
      setError("Unable to open billing management right now.");
    } finally {
      setPortalLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm font-semibold text-red-800">Billing error</p>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const activeSubs = data.subscriptions.filter((s) => s.status === "active" || s.status === "trialing");
  const currentPlan = activeSubs[0]?.planCode ?? null;
  const primaryMethod = data.paymentMethods[0] ?? null;
  const activeEntitlements = entitlementEntries(data.entitlements);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Account status</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
            {formatBillingSetupState(data.account?.status, "Setup pending")}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {data.account?.billingEmail
              ? `Billing email: ${data.account.billingEmail}`
              : "No billing email configured yet."}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Commercial plan</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
            {currentPlan ?? "Free"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {activeSubs.length > 0
              ? `${activeSubs.length} active subscription${activeSubs.length > 1 ? "s" : ""}`
              : "No active subscriptions."}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Payment method</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
            {primaryMethod?.brand ? `${primaryMethod.brand} •••• ${primaryMethod.last4}` : "Not configured"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {primaryMethod?.expMonth && primaryMethod.expYear
              ? `Expires ${primaryMethod.expMonth}/${primaryMethod.expYear}`
              : "No saved payment method is attached to this org yet."}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Dunning state</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 capitalize">
            {formatBillingSetupState(data.dunningState, "No ledger")}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {data.dunningState === "healthy" || data.dunningState === "none"
              ? "No overdue payments."
              : data.dunningState === "unknown"
                ? "Billing monitoring will appear here once an account or invoice ledger is attached."
              : "Action may be needed on overdue invoices."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {data.account?.stripeCustomerId ? (
          <button
            type="button"
            onClick={openPortal}
            disabled={portalLoading}
            className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {portalLoading ? "Opening portal…" : "Manage billing in Stripe"}
          </button>
        ) : null}
        <a
          href="/legal/payment"
          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Review payment policy
        </a>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Account and tax profile</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Billing contact</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {data.account?.billingContactName ?? data.account?.billingEmail ?? "Not set"}
              </p>
              <p className="mt-1 text-sm text-slate-500">{data.account?.billingEmail ?? "No billing email available yet."}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tax posture</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {data.tax?.taxCountry ?? "Country not set"}
                {data.tax?.taxState ? `, ${data.tax.taxState}` : ""}
              </p>
              <p className="mt-1 text-sm text-slate-500">{data.tax?.taxId ?? "No tax identifier on file."}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Entitlements</h2>
          {activeEntitlements.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No commercial entitlements have been granted yet.</p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {activeEntitlements.map(([key, value]) => (
                <span key={key} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                  {key}: {String(value)}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Subscriptions</h2>
        {data.subscriptions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No subscriptions yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">Product</th>
                  <th className="pb-3 pr-4">Plan</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Interval</th>
                  <th className="pb-3">Period ends</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.subscriptions.map((sub) => (
                  <tr key={sub.id}>
                    <td className="py-3 pr-4 font-medium text-slate-900">{sub.productFamily}</td>
                    <td className="py-3 pr-4 text-slate-700">{sub.planCode}</td>
                    <td className="py-3 pr-4">{statusBadge(sub.status)}</td>
                    <td className="py-3 pr-4 text-slate-600 capitalize">{sub.billingInterval}</td>
                    <td className="py-3 text-slate-600">
                      {sub.currentPeriodEnd
                        ? new Date(sub.currentPeriodEnd).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Usage summary</h2>
        {data.usageSummary.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No billable usage has been recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">Product</th>
                  <th className="pb-3 pr-4">Meter</th>
                  <th className="pb-3 pr-4">Quantity</th>
                  <th className="pb-3">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.usageSummary.map((entry) => (
                  <tr key={`${entry.productFamily}:${entry.meterName}`}>
                    <td className="py-3 pr-4 font-medium text-slate-900">{entry.productFamily}</td>
                    <td className="py-3 pr-4 text-slate-600">{entry.meterName}</td>
                    <td className="py-3 pr-4 text-slate-600">{entry.totalQuantity}</td>
                    <td className="py-3 text-slate-600">{entry.eventCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Invoices</h2>
        {data.invoices.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No invoices yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">Amount</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Issued</th>
                  <th className="pb-3 pr-4">Paid</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      {formatCurrency(inv.total, inv.currency)}
                    </td>
                    <td className="py-3 pr-4">{statusBadge(inv.status)}</td>
                    <td className="py-3 pr-4 text-slate-600">
                      {inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3 space-x-2">
                      {inv.hostedInvoiceUrl && (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 font-medium"
                        >
                          View
                        </a>
                      )}
                      {inv.invoicePdf && (
                        <a
                          href={inv.invoicePdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 font-medium"
                        >
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

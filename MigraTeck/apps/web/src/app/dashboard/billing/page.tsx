import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import Link from "next/link";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const API_BASE = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";

async function fetchBilling<T>(path: string, orgId: string, sessionCookie: string): Promise<T> {
  const res = await fetch(`${API_BASE}/v1${path}`, {
    headers: {
      "x-org-id": orgId,
      cookie: sessionCookie,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Billing API error: ${res.status}`);
  return res.json() as Promise<T>;
}

interface BillingOverview {
  account: { status: string; billingEmail: string | null; defaultCurrency: string } | null;
  subscriptionCount: number;
  dunningState: string;
}

export default async function BillingPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const orgId = session.activeOrgId;

  if (!orgId) {
    return (
      <section className="px-6 py-16">
        <div className={cn(ui.maxWNarrow)}>
          <div className={cn(ui.card, "p-8 text-center")}>
            <h1 className="font-display text-2xl font-semibold text-slate-900">
              Select an organization
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Choose an organization to view billing information.
            </p>
          </div>
        </div>
      </section>
    );
  }

  let overview: BillingOverview | null = null;
  try {
    const [account, subscriptions, dunning] = await Promise.all([
      fetchBilling<any>("/billing/account", orgId, "").catch(() => null),
      fetchBilling<any[]>("/billing/subscriptions", orgId, "").catch(() => []),
      fetchBilling<{ dunningState: string }>("/billing/dunning", orgId, "").catch(() => ({ dunningState: "unknown" })),
    ]);
    overview = {
      account,
      subscriptionCount: Array.isArray(subscriptions) ? subscriptions.length : 0,
      dunningState: dunning.dunningState,
    };
  } catch {
    // API not available — show placeholder
  }

  const navItems = [
    { href: "/dashboard/billing/subscriptions", label: "Subscriptions", desc: "View and manage active plans" },
    { href: "/dashboard/billing/invoices", label: "Invoices", desc: "View billing history and receipts" },
    { href: "/dashboard/billing/payment-methods", label: "Payment Methods", desc: "Manage cards and payment sources" },
    { href: "/dashboard/billing/usage", label: "Usage", desc: "Track metered usage across products" },
    { href: "/dashboard/billing/entitlements", label: "Entitlements", desc: "View current plan capabilities" },
    { href: "/dashboard/billing/quotes", label: "Quotes", desc: "Enterprise and custom pricing quotes" },
  ];

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Billing & subscriptions</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-slate-950">
            Billing
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Manage subscriptions, payment methods, invoices, and usage for your organization.
          </p>
        </div>

        {/* Overview cards */}
        {overview?.account && (
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            <div className={cn(ui.card, "p-5")}>
              <p className={ui.eyebrow}>Account Status</p>
              <p className="mt-3 text-lg font-semibold capitalize text-slate-900">
                {overview.account.status}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {overview.account.billingEmail ?? "No billing email"}
              </p>
            </div>
            <div className={cn(ui.card, "p-5")}>
              <p className={ui.eyebrow}>Active Subscriptions</p>
              <p className="mt-3 text-lg font-semibold text-slate-900">
                {overview.subscriptionCount}
              </p>
            </div>
            <div className={cn(ui.card, "p-5")}>
              <p className={ui.eyebrow}>Payment Status</p>
              <p className={cn(
                "mt-3 text-lg font-semibold capitalize",
                overview.dunningState === "active" ? "text-emerald-600" : "text-amber-600",
              )}>
                {overview.dunningState}
              </p>
            </div>
          </div>
        )}

        {/* Navigation grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(ui.card, ui.cardHover, "block p-6")}
            >
              <h2 className="text-base font-semibold text-slate-900">{item.label}</h2>
              <p className="mt-1 text-sm text-slate-600">{item.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

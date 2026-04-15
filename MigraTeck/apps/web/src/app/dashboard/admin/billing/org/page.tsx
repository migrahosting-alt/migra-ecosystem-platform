import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const API_BASE = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";

interface AdminOrgBilling {
  account: {
    id: string;
    orgId: string;
    status: string;
    billingEmail: string | null;
    defaultCurrency: string;
    stripeCustomerId: string | null;
    taxCountry: string | null;
    createdAt: string;
  } | null;
  subscriptions: Array<{
    id: string;
    productFamily: string;
    planCode: string;
    status: string;
    billingInterval: string;
    currentPeriodEnd: string | null;
  }>;
  dunningState: string;
}

export default async function AdminOrgBillingPage(props: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  ensureAuthClientInitialized();
  await requirePermission("platform.admin");

  const { orgId } = await props.searchParams;

  if (!orgId) {
    return (
      <section className="px-6 py-16">
        <div className={cn(ui.maxWNarrow, ui.card, "p-8 text-center")}>
          <p className="text-sm text-slate-600">Provide an org ID to look up billing info.</p>
        </div>
      </section>
    );
  }

  let data: AdminOrgBilling | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(`${API_BASE}/v1/admin/billing/orgs/${orgId}`, {
      headers: {
        "x-user-role": "PLATFORM_ADMIN",
        "x-user-id": "admin",
      },
      cache: "no-store",
    });
    if (res.ok) {
      data = await res.json();
    } else {
      error = `API returned ${res.status}`;
    }
  } catch {
    error = "Billing API unavailable";
  }

  const statusColor: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    trialing: "bg-sky-50 text-sky-700 border-sky-200",
    past_due: "bg-amber-50 text-amber-700 border-amber-200",
    canceled: "bg-slate-50 text-slate-500 border-slate-200",
    paused: "bg-purple-50 text-purple-700 border-purple-200",
    suspended: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Admin · Billing</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
            Org: {orgId}
          </h1>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* Account */}
            <div className={cn(ui.card, "p-6")}>
              <h2 className={cn(ui.eyebrow, "mb-4")}>Billing Account</h2>
              {data.account ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-slate-500">Status</p>
                    <p className="mt-1 font-semibold capitalize text-slate-900">
                      {data.account.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Email</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {data.account.billingEmail ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Stripe Customer</p>
                    <p className="mt-1 font-mono text-xs text-slate-600">
                      {data.account.stripeCustomerId ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Currency</p>
                    <p className="mt-1 text-sm uppercase text-slate-700">
                      {data.account.defaultCurrency}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Tax Country</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {data.account.taxCountry ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Created</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {new Date(data.account.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No billing account found.</p>
              )}
            </div>

            {/* Dunning */}
            <div className={cn(ui.card, "flex items-center justify-between p-6")}>
              <div>
                <h2 className={ui.eyebrow}>Dunning State</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Current payment recovery state for this organization.
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm font-semibold capitalize",
                  statusColor[data.dunningState] ?? "bg-slate-50 text-slate-500 border-slate-200",
                )}
              >
                {data.dunningState}
              </span>
            </div>

            {/* Subscriptions */}
            <div className={cn(ui.card, "overflow-hidden")}>
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className={ui.eyebrow}>Subscriptions ({data.subscriptions.length})</h2>
              </div>
              {data.subscriptions.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No subscriptions.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.subscriptions.map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between px-6 py-4">
                      <div>
                        <p className="text-sm font-semibold capitalize text-slate-900">
                          {sub.productFamily} — {sub.planCode}
                        </p>
                        <p className="text-xs text-slate-500">
                          Billed {sub.billingInterval}ly
                          {sub.currentPeriodEnd &&
                            ` · Period ends ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                          statusColor[sub.status] ?? "bg-slate-50 text-slate-500 border-slate-200",
                        )}
                      >
                        {sub.status.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

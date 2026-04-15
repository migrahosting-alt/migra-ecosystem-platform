import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const API_BASE = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";

interface Subscription {
  id: string;
  productFamily: string;
  planCode: string;
  status: string;
  billingInterval: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
}

export default async function SubscriptionsPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const orgId = session.activeOrgId;

  if (!orgId) {
    return (
      <section className="px-6 py-16">
        <div className={cn(ui.maxWNarrow, ui.card, "p-8 text-center")}>
          <p className="text-sm text-slate-600">Select an organization to view subscriptions.</p>
        </div>
      </section>
    );
  }

  let subscriptions: Subscription[] = [];
  try {
    const res = await fetch(`${API_BASE}/v1/billing/subscriptions`, {
      headers: { "x-org-id": orgId },
      cache: "no-store",
    });
    if (res.ok) subscriptions = await res.json();
  } catch {
    // API unavailable
  }

  const statusColor: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    trialing: "bg-sky-50 text-sky-700 border-sky-200",
    past_due: "bg-amber-50 text-amber-700 border-amber-200",
    canceled: "bg-slate-50 text-slate-500 border-slate-200",
    paused: "bg-purple-50 text-purple-700 border-purple-200",
  };

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Billing</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
            Subscriptions
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Active plans across all MigraTeck products.
          </p>
        </div>

        {subscriptions.length === 0 ? (
          <div className={cn(ui.card, "p-8 text-center")}>
            <p className="text-sm text-slate-500">No active subscriptions.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {subscriptions.map((sub) => (
              <div key={sub.id} className={cn(ui.card, "p-6")}>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-semibold capitalize text-slate-900">
                      {sub.productFamily} — {sub.planCode}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Billed {sub.billingInterval}ly
                      {sub.currentPeriodEnd &&
                        ` · Renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`}
                    </p>
                    {sub.trialEndsAt && (
                      <p className="mt-1 text-xs text-sky-600">
                        Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}
                      </p>
                    )}
                    {sub.cancelAtPeriodEnd && (
                      <p className="mt-1 text-xs text-amber-600">Cancels at period end</p>
                    )}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

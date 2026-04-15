import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function BillingAdminPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.admin");

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Admin</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
            Billing Administration
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Platform-wide billing operations, org lookups, and support tools.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className={cn(ui.card, "p-6")}>
            <h2 className="text-base font-semibold text-slate-900">Org Billing Lookup</h2>
            <p className="mt-1 text-sm text-slate-600">
              Search by org ID to view billing account, subscriptions, dunning state, and entitlements.
            </p>
            <form className="mt-4 flex gap-2" action="/dashboard/admin/billing/org" method="GET">
              <input
                name="orgId"
                type="text"
                placeholder="Organization ID"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Lookup
              </button>
            </form>
          </div>

          <div className={cn(ui.card, "p-6")}>
            <h2 className="text-base font-semibold text-slate-900">Support Actions</h2>
            <p className="mt-1 text-sm text-slate-600">
              Issue credits, override entitlements, reconcile billing state, retry failed webhooks.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                Credits
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                Override Entitlements
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                Reconcile
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                Retry Webhooks
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

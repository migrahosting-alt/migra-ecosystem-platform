import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const API_BASE = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";

interface UsageSummaryEntry {
  productFamily: string;
  meterName: string;
  totalQuantity: number;
  eventCount: number;
  firstEvent: string;
  lastEvent: string;
}

export default async function UsagePage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const orgId = session.activeOrgId;

  if (!orgId) {
    return (
      <section className="px-6 py-16">
        <div className={cn(ui.maxWNarrow, ui.card, "p-8 text-center")}>
          <p className="text-sm text-slate-600">Select an organization to view usage.</p>
        </div>
      </section>
    );
  }

  let usage: UsageSummaryEntry[] = [];
  try {
    const res = await fetch(`${API_BASE}/v1/billing/usage/summary`, {
      headers: { "x-org-id": orgId },
      cache: "no-store",
    });
    if (res.ok) usage = await res.json();
  } catch {
    // API unavailable
  }

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Billing</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
            Usage
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Metered usage across all MigraTeck products in the current billing period.
          </p>
        </div>

        {usage.length === 0 ? (
          <div className={cn(ui.card, "p-8 text-center")}>
            <p className="text-sm text-slate-500">No metered usage recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Product
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Meter
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Quantity
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Events
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Period
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {usage.map((entry, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4 font-medium capitalize text-slate-900">
                      {entry.productFamily}
                    </td>
                    <td className="px-6 py-4 text-slate-700">{entry.meterName}</td>
                    <td className="px-6 py-4 font-mono text-slate-900">
                      {entry.totalQuantity.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{entry.eventCount}</td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(entry.firstEvent).toLocaleDateString()} –{" "}
                      {new Date(entry.lastEvent).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

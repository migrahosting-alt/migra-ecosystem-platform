import { requirePermission } from "@migrateck/auth-client";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { getCommercialSnapshot } from "@/lib/platform/commercial";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const orgName = session.activeOrgName ?? "My Organization";
  const commercial = await getCommercialSnapshot(session.activeOrgId);
  const billingState = commercial.dunningState === "unknown"
    ? "Not attached"
    : commercial.dunningState.replace(/_/g, " ");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader eyebrow="Consumption and limits" title="Usage" description={`Shared usage and metering signals for ${orgName}.`} />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <PlatformStatCard label="Usage signals" value={String(commercial.usageSummary.length)} detail="Distinct usage meters currently visible for the active organization." />
        <PlatformStatCard label="Subscriptions" value={String(commercial.subscriptions.length)} detail="Usage rolls up against the active commercial subscriptions and entitlements." />
        <PlatformStatCard label="Billing state" value={billingState} detail="Usage is visible even when no billable events have been recorded yet." />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Usage history</h2>
        {commercial.usageSummary.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
            <p className="text-sm text-slate-500">No usage data yet.</p>
            <p className="mt-1 text-xs text-slate-400">Usage charts will appear here when the active organization starts generating billable events.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Product</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Meter</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Quantity</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {commercial.usageSummary.map((entry) => (
                  <tr key={`${entry.productFamily}:${entry.meterName}`}>
                    <td className="px-6 py-4 font-medium text-slate-900">{entry.productFamily}</td>
                    <td className="px-6 py-4 text-slate-600">{entry.meterName}</td>
                    <td className="px-6 py-4 text-slate-600">{entry.totalQuantity}</td>
                    <td className="px-6 py-4 text-slate-600">{entry.eventCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

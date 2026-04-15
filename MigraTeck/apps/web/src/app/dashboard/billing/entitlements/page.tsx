import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const API_BASE = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";

type OrgEntitlements = Record<string, string | number | boolean>;

export default async function EntitlementsPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const orgId = session.activeOrgId;

  if (!orgId) {
    return (
      <section className="px-6 py-16">
        <div className={cn(ui.maxWNarrow, ui.card, "p-8 text-center")}>
          <p className="text-sm text-slate-600">Select an organization to view entitlements.</p>
        </div>
      </section>
    );
  }

  let entitlements: OrgEntitlements = {};
  try {
    const res = await fetch(`${API_BASE}/v1/billing/entitlements`, {
      headers: { "x-org-id": orgId },
      cache: "no-store",
    });
    if (res.ok) entitlements = await res.json();
  } catch {
    // API unavailable
  }

  const entries = Object.entries(entitlements);

  // Group by product family prefix
  const grouped: Record<string, [string, string | number | boolean][]> = {};
  for (const [key, value] of entries) {
    const [firstPart] = key.split(".");
    const group = firstPart && key.includes(".") ? firstPart : "general";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push([key, value]);
  }

  function renderValue(value: string | number | boolean): string {
    if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
    if (typeof value === "number") return value === -1 ? "Unlimited" : value.toLocaleString();
    return String(value);
  }

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Billing</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
            Entitlements
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Current resolved capabilities for your organization based on active subscriptions.
          </p>
        </div>

        {entries.length === 0 ? (
          <div className={cn(ui.card, "p-8 text-center")}>
            <p className="text-sm text-slate-500">No entitlements resolved.</p>
            <p className="mt-2 text-xs text-slate-400">
              Entitlements are granted when you subscribe to a product.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([group, items]) => (
                <div key={group} className={cn(ui.card, "overflow-hidden")}>
                  <div className="border-b border-slate-100 bg-slate-50 px-6 py-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {group}
                    </h2>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {items.map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between px-6 py-3"
                      >
                        <code className="text-xs text-slate-600">{key}</code>
                        <span
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            typeof value === "boolean"
                              ? value
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-400"
                              : "bg-sky-50 text-sky-700",
                          )}
                        >
                          {renderValue(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

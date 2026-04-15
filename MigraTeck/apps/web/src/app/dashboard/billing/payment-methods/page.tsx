import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const API_BASE = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";

interface PaymentMethod {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

export default async function PaymentMethodsPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const orgId = session.activeOrgId;

  if (!orgId) {
    return (
      <section className="px-6 py-16">
        <div className={cn(ui.maxWNarrow, ui.card, "p-8 text-center")}>
          <p className="text-sm text-slate-600">Select an organization to manage payment methods.</p>
        </div>
      </section>
    );
  }

  let methods: PaymentMethod[] = [];
  try {
    const res = await fetch(`${API_BASE}/v1/billing/payment-methods`, {
      headers: { "x-org-id": orgId },
      cache: "no-store",
    });
    if (res.ok) methods = await res.json();
  } catch {
    // API unavailable
  }

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Billing</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
            Payment Methods
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Cards and payment sources linked to your billing account.
          </p>
        </div>

        {methods.length === 0 ? (
          <div className={cn(ui.card, "p-8 text-center")}>
            <p className="text-sm text-slate-500">No payment methods on file.</p>
            <p className="mt-2 text-xs text-slate-400">
              Payment methods are added automatically during checkout.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {methods.map((pm) => (
              <div key={pm.id} className={cn(ui.card, "flex items-center justify-between p-6")}>
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                    <span className="text-xs font-bold uppercase text-slate-600">
                      {pm.brand ?? pm.type}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {pm.brand ? `${pm.brand} ` : ""}
                      •••• {pm.last4 ?? "????"}
                    </p>
                    {pm.expMonth != null && pm.expYear != null && (
                      <p className="text-xs text-slate-500">
                        Expires {String(pm.expMonth).padStart(2, "0")}/{pm.expYear}
                      </p>
                    )}
                  </div>
                </div>
                {pm.isDefault && (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Default
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

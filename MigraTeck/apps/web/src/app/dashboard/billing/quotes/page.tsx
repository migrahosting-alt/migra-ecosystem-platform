import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const API_BASE = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";

interface Quote {
  id: string;
  status: string;
  stripeQuoteId: string | null;
  description: string | null;
  header: string | null;
  amountTotal: number | null;
  currency: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default async function QuotesPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const orgId = session.activeOrgId;

  if (!orgId) {
    return (
      <section className="px-6 py-16">
        <div className={cn(ui.maxWNarrow, ui.card, "p-8 text-center")}>
          <p className="text-sm text-slate-600">Select an organization to view quotes.</p>
        </div>
      </section>
    );
  }

  let quotes: Quote[] = [];
  try {
    const res = await fetch(`${API_BASE}/v1/billing/quotes`, {
      headers: { "x-org-id": orgId },
      cache: "no-store",
    });
    if (res.ok) quotes = await res.json();
  } catch {
    // API unavailable
  }

  const statusColor: Record<string, string> = {
    draft: "bg-slate-50 text-slate-500 border-slate-200",
    open: "bg-amber-50 text-amber-700 border-amber-200",
    accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
    canceled: "bg-red-50 text-red-500 border-red-200",
  };

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Billing</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
            Quotes
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Enterprise and custom pricing quotes for your organization.
          </p>
        </div>

        {quotes.length === 0 ? (
          <div className={cn(ui.card, "p-8 text-center")}>
            <p className="text-sm text-slate-500">No quotes available.</p>
            <p className="mt-2 text-xs text-slate-400">
              Contact sales for enterprise or custom pricing.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {quotes.map((q) => (
              <div key={q.id} className={cn(ui.card, "p-6")}>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {q.header ?? `Quote ${q.id.slice(0, 8)}`}
                    </h2>
                    {q.description && (
                      <p className="mt-1 text-sm text-slate-600">{q.description}</p>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      Created {new Date(q.createdAt).toLocaleDateString()}
                      {q.expiresAt &&
                        ` · Expires ${new Date(q.expiresAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {q.amountTotal != null && q.currency && (
                      <span className="text-sm font-semibold text-slate-900">
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: q.currency.toUpperCase(),
                        }).format(q.amountTotal / 100)}
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                        statusColor[q.status] ?? "bg-slate-50 text-slate-500",
                      )}
                    >
                      {q.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

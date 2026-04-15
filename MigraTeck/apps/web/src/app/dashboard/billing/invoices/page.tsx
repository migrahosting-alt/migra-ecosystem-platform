import { requirePermission } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const API_BASE = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";

interface Invoice {
  id: string;
  status: string;
  currency: string;
  total: number;
  amountPaid: number;
  amountRemaining: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

export default async function InvoicesPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const orgId = session.activeOrgId;

  if (!orgId) {
    return (
      <section className="px-6 py-16">
        <div className={cn(ui.maxWNarrow, ui.card, "p-8 text-center")}>
          <p className="text-sm text-slate-600">Select an organization to view invoices.</p>
        </div>
      </section>
    );
  }

  let invoices: Invoice[] = [];
  try {
    const res = await fetch(`${API_BASE}/v1/billing/invoices`, {
      headers: { "x-org-id": orgId },
      cache: "no-store",
    });
    if (res.ok) invoices = await res.json();
  } catch {
    // API unavailable
  }

  const statusColor: Record<string, string> = {
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    open: "bg-amber-50 text-amber-700 border-amber-200",
    draft: "bg-slate-50 text-slate-500 border-slate-200",
    void: "bg-slate-50 text-slate-400 border-slate-200",
    uncollectible: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <section className="px-6 py-16">
      <div className={cn(ui.maxWNarrow)}>
        <div className="mb-8">
          <p className={ui.eyebrowBrand}>Billing</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
            Invoices
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Billing history and downloadable receipts.
          </p>
        </div>

        {invoices.length === 0 ? (
          <div className={cn(ui.card, "p-8 text-center")}>
            <p className="text-sm text-slate-500">No invoices yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Date
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-6 py-4 text-slate-700">
                      {inv.issuedAt
                        ? new Date(inv.issuedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {formatCurrency(inv.total, inv.currency)}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                          statusColor[inv.status] ?? "bg-slate-50 text-slate-500",
                        )}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-3">
                        {inv.hostedInvoiceUrl && (
                          <a
                            href={inv.hostedInvoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            View
                          </a>
                        )}
                        {inv.invoicePdf && (
                          <a
                            href={inv.invoicePdf}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            PDF
                          </a>
                        )}
                      </div>
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

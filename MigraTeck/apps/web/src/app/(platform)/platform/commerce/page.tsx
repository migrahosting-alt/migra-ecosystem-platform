import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { BadgeDollarSign, CreditCard, Boxes, ChartNoAxesCombined, ArrowRight, ReceiptText } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { getCommercialSnapshot } from "@/lib/platform/commercial";

export const dynamic = "force-dynamic";

export default async function CommerceOverviewPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const commercial = await getCommercialSnapshot(session.activeOrgId);

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Commercial infrastructure"
        title="Commerce"
        description="MigraPay is the authoritative commercial layer for products, prices, subscriptions, invoices, payment methods, entitlements, usage charging, and reconciliation."
        actions={
          <Link
            href="/platform/billing"
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Open MigraPay & Billing <ArrowRight size={15} />
          </Link>
        }
      />

      <section className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#fffaf5,#f8f6ff)] p-6 shadow-sm">
        <div className="grid gap-5 md:grid-cols-4">
          {[
            { label: "Billing account", value: commercial.account?.status ?? "No active org", icon: CreditCard },
            { label: "Subscriptions", value: String(commercial.subscriptions.length), icon: BadgeDollarSign },
            { label: "Invoices", value: String(commercial.invoices.length), icon: ReceiptText },
            { label: "Usage meters", value: String(commercial.usageSummary.length), icon: ChartNoAxesCombined },
          ].map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="rounded-2xl border border-white/90 bg-white/90 p-5">
                <Icon size={18} className="text-violet-600" />
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{metric.label}</p>
                <p className="mt-2 text-xl font-semibold text-slate-950">{metric.value}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600"><BadgeDollarSign size={19} /></span>
          <h2 className="mt-4 text-base font-semibold text-slate-950">MigraPay Ledger</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Billing account, subscriptions, invoices, payment methods, tax, dunning, and processor reconciliation belong to one canonical commerce model.</p>
          <Link href="/platform/billing" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">Open billing <ArrowRight size={14} /></Link>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><Boxes size={19} /></span>
          <h2 className="mt-4 text-base font-semibold text-slate-950">Catalog & Entitlements</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">The repo already contains a product catalog synchronized to processor prices. Entitlements are the product-access contract consumed by the ecosystem.</p>
          <Link href="/platform/commerce/catalog" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">Open catalog & entitlements <ArrowRight size={14} /></Link>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-600"><ChartNoAxesCombined size={19} /></span>
          <h2 className="mt-4 text-base font-semibold text-slate-950">Usage & Metering</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Metered product consumption already feeds the commercial snapshot. The next layer is rate-card control, event inspection, and charge reconciliation.</p>
          <Link href="/platform/commerce/usage" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">Open usage & metering <ArrowRight size={14} /></Link>
        </article>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Commercial authority rule</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
          Products may request purchases and report usage, but they do not own canonical prices, charge amounts, subscription state, invoice state, or entitlements. Stripe and other processors are downstream processors; MigraPay remains the system of record.
        </p>
      </section>
    </div>
  );
}

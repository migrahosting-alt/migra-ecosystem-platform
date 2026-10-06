import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  ArrowLeft,
  BadgeDollarSign,
  CreditCard,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { BillingOperationsWorkspace } from "./BillingOperationsWorkspace";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Commerce / Payment operations"
        title="MigraPay & Billing"
        description="Operate the commercial ledger against Stripe evidence: customers, subscriptions, invoices, payment methods, webhook health, reconciliation, and guarded subscription lifecycle actions."
        actions={
          <Link
            href="/platform/commerce"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Commerce overview
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <BadgeDollarSign size={19} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Ledger + processor truth</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Local billing state is compared against live Stripe customer, subscription, invoice, and payment-method evidence.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <RefreshCw size={19} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Controlled reconciliation</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Operator-triggered reconciliation is reasoned, audited, pagination-bounded, and refuses incomplete Stripe history.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <CreditCard size={19} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Safe payment evidence</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Payment methods expose only safe metadata such as brand, last four digits, and expiry—not card numbers or CVC.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={19} className="text-amber-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Narrow financial authority</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Read access and billing mutation authority are separate. Subscription changes require platform.commerce.billing.manage.
          </p>
        </article>
      </div>

      <BillingOperationsWorkspace />
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRightLeft,
  Ban,
  Cable,
  CircleAlert,
  CircleCheck,
  CreditCard,
  ExternalLink,
  PhoneCall,
  Receipt,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { getSession } from "../lib/auth";
import { panelQuery } from "../lib/db";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { SubmitButton } from "../components/SubmitButton";
import { loadBillingReadiness } from "../lib/modules/billing-readiness";
import { loadBillingData } from "../lib/modules/billing";
import {
  createBillingPaymentRequest,
  recordProcessedPayment,
  updateInvoiceStatus,
} from "../lib/modules/billing-actions";
import { loadRecentOrders } from "../lib/modules/orders";
import { loadTenantHeader } from "../lib/modules/tenants";
import { tenantPath } from "../lib/urls";

export const dynamic = "force-dynamic";

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; returnTo?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const sp = await searchParams;
  const tenantId = (sp.tenantId || "").trim();
  const returnTo = (sp.returnTo || "").trim();
  const error = (sp.error || "").trim();

  const [data, tenant, orders, tenants] = await Promise.all([
    loadBillingData(tenantId ? { tenantId } : {}),
    tenantId ? loadTenantHeader(tenantId) : Promise.resolve(null),
    loadRecentOrders(tenantId ? { tenantId, limit: 12 } : { limit: 12 }),
    panelQuery<{ id: string; name: string }>(
      `SELECT id, COALESCE(name, company_name, slug, id) AS name
         FROM tenants
        WHERE COALESCE(is_active, TRUE) = TRUE
        ORDER BY name ASC
        LIMIT 250`,
    ),
  ]);

  const { invoices, payments, subscriptions, paymentMethods } = data;
  const readiness = loadBillingReadiness();

  const activeSubs = subscriptions.filter((s) => ["active", "trialing"].includes(s.status));
  const overdueInvoices = invoices.filter((i) => ["open", "past_due"].includes(i.status.toLowerCase()));
  const paidInvoices = invoices.filter((i) => ["paid", "captured", "succeeded"].includes(i.status.toLowerCase()));
  const draftInvoices = invoices.filter((i) => i.status.toLowerCase() === "draft");
  const mrr = activeSubs.reduce((acc, s) => acc + (s.renewalRate ?? s.originalRate ?? 0), 0);
  const overdue = overdueInvoices.reduce((acc, i) => acc + i.total, 0);
  const paidThisMonth = paidInvoices.reduce((acc, i) => acc + i.total, 0);
  const assistedPayments = orders.filter((order) => !!order.paymentLinkUrl);
  const recordedPhonePayments = payments.filter((payment) =>
    ["stripe_terminal_moto", "virtual_terminal", "phone_ach"].includes((payment.provider || "").toLowerCase()),
  );
  const billingScope = tenantId
    ? `/console/billing?tenantId=${encodeURIComponent(tenantId)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`
    : "/console/billing";
  const tenantOptions = tenants.map((entry) => ({ value: entry.id, label: entry.name }));
  const invoiceOptions = invoices
    .filter((invoice) => ["open", "past_due", "draft"].includes(invoice.status.toLowerCase()))
    .map((invoice) => ({
      value: invoice.id,
      label: `${invoice.tenantName || invoice.tenantId || "Client"} · ${fmtUsd(invoice.total)} · ${invoice.status}`,
    }));

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/billing"
      title="Billing"
      subtitle={
        tenant
          ? `${tenant.name} · collections, payments, subscriptions, and finance operations`
          : "Collections, payments, subscriptions, and finance operations."
      }
      actions={
        tenant && returnTo ? (
          <Link
            href={returnTo}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
          >
            Back to Client
          </Link>
        ) : undefined
      }
    >
      {error ? (
        <div className="mb-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      <section className="relative overflow-hidden rounded-[28px] border border-emerald-400/15 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(34,211,238,0.14),_transparent_26%),linear-gradient(140deg,rgba(7,11,24,0.98),rgba(8,14,28,0.92))] p-6 shadow-2xl shadow-slate-950/40">
        <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.04),transparent)] lg:block" />
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-200">
              Collections Command Center
            </div>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white">
              {tenant ? `Own ${tenant.name}'s cash cycle with confidence.` : "Run collections like a control room, not a spreadsheet."}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              This workspace is built for collections pressure, live payment assistance, reconciliation, and phone-payment readiness. It should feel decisive, not generic.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricPanel eyebrow="MRR" value={fmtUsd(mrr)} detail={`${activeSubs.length} active recurring account(s)`} tone="emerald" />
              <MetricPanel eyebrow="Collected" value={fmtUsd(paidThisMonth)} detail={`${paidInvoices.length} paid invoice(s) in view`} tone="cyan" />
              <MetricPanel eyebrow="Exposure" value={fmtUsd(overdue)} detail={overdueInvoices.length ? `${overdueInvoices.length} invoice(s) need action` : "No overdue balance pressure"} tone={overdue > 0 ? "rose" : "slate"} />
              <MetricPanel eyebrow="Phone Assist" value={assistedPayments.length} detail={recordedPhonePayments.length ? `${recordedPhonePayments.length} phone/terminal payment(s) logged` : "No phone payments logged yet"} tone="amber" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-5 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Collections Focus</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {overdueInvoices[0]?.tenantName || overdueInvoices[0]?.tenantId || "Portfolio stable"}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {overdueInvoices[0]
                    ? `${fmtUsd(overdueInvoices[0].total)} is the next invoice demanding attention.`
                    : "No overdue invoice is currently leading the queue."}
                </p>
              </div>
              <StatusPill status={overdue > 0 ? "follow up" : "stable"} variant={overdue > 0 ? "warn" : "ok"} />
            </div>

            <div className="mt-5 space-y-3">
              <FocusStrip
                label="Hosted-assisted checkout"
                value={readiness.assistedCollectionReady ? "Ready now" : "Blocked"}
                detail={readiness.assistedCollectionReady ? "Operators can collect while staying on the phone." : "Stripe secret key still missing."}
                tone={readiness.assistedCollectionReady ? "ok" : "warn"}
              />
              <FocusStrip
                label="True phone card entry"
                value={readiness.fullMotoReady ? "Terminal-ready" : "Not ready"}
                detail={readiness.fullMotoReady ? "Terminal MOTO prerequisites are configured." : "Reader, location, webhook, or MOTO approval still missing."}
                tone={readiness.fullMotoReady ? "ok" : "bad"}
              />
              <FocusStrip
                label="Stored billing instruments"
                value={tenant ? `${paymentMethods.length} on file` : "Scope to client"}
                detail={tenant ? "Client-scoped cards and methods show below." : "Client-scoped view reveals attached methods."}
                tone="neutral"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <SectionCard
          title="Collections Workspace"
          subtitle="Assist live collections, process approved phone payments, and keep a clean audit trail."
          className="border-cyan-400/15 bg-[linear-gradient(180deg,rgba(14,24,40,0.94),rgba(8,14,28,0.9))]"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <ActionDeck
              icon={<PhoneCall className="h-4 w-4 text-cyan-200" />}
              title="Assisted secure checkout"
              subtitle="The fastest safe path for same-call collections."
              tone="cyan"
            >
              <form action={createBillingPaymentRequest} className="space-y-3">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="redirectTo" value={billingScope} />
                {tenant ? (
                  <input type="hidden" name="tenantId" value={tenant.id} />
                ) : (
                  <select
                    name="tenantId"
                    required
                    defaultValue=""
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-cyan-400/40 focus:outline-none"
                  >
                    <option value="" className="bg-slate-900">Select client</option>
                    {tenantOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-slate-900">{option.label}</option>
                    ))}
                  </select>
                )}
                <input
                  name="description"
                  required
                  placeholder="Charge description"
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
                />
                {invoiceOptions.length > 0 ? (
                  <select
                    name="invoiceId"
                    defaultValue=""
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-cyan-400/40 focus:outline-none"
                  >
                    <option value="" className="bg-slate-900">Reference invoice (optional)</option>
                    {invoiceOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-slate-900">{option.label}</option>
                    ))}
                  </select>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="Amount"
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
                  />
                  <input
                    name="taxRatePct"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue="0"
                    placeholder="Tax %"
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
                  />
                </div>
                <label className="flex items-center gap-2 text-[10px] text-slate-400">
                  <input type="checkbox" name="sendLink" defaultChecked className="rounded border-white/20 bg-white/5" />
                  Generate Stripe payment link now
                </label>
                <SubmitButton tone="accent" size="sm">
                  <CreditCard className="h-3 w-3" /> Create Payment Request
                </SubmitButton>
              </form>
            </ActionDeck>

            <ActionDeck
              icon={<ShieldCheck className="h-4 w-4 text-emerald-200" />}
              title="Record approved payment"
              subtitle="Capture the ledger after a controlled external charge."
              tone="emerald"
            >
              <form action={recordProcessedPayment} className="space-y-3">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="redirectTo" value={billingScope} />
                {tenant ? (
                  <input type="hidden" name="tenantId" value={tenant.id} />
                ) : (
                  <select
                    name="tenantId"
                    required
                    defaultValue=""
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-emerald-400/40 focus:outline-none"
                  >
                    <option value="" className="bg-slate-900">Select client</option>
                    {tenantOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-slate-900">{option.label}</option>
                    ))}
                  </select>
                )}
                {invoiceOptions.length > 0 ? (
                  <select
                    name="invoiceId"
                    defaultValue=""
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-emerald-400/40 focus:outline-none"
                  >
                    <option value="" className="bg-slate-900">Apply to invoice (optional)</option>
                    {invoiceOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-slate-900">{option.label}</option>
                    ))}
                  </select>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="Amount"
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none"
                  />
                  <select
                    name="status"
                    defaultValue="captured"
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-emerald-400/40 focus:outline-none"
                  >
                    <option value="captured" className="bg-slate-900">Captured</option>
                    <option value="paid" className="bg-slate-900">Paid</option>
                    <option value="succeeded" className="bg-slate-900">Succeeded</option>
                    <option value="pending" className="bg-slate-900">Pending</option>
                  </select>
                </div>
                <select
                  name="provider"
                  defaultValue="stripe_terminal_moto"
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-emerald-400/40 focus:outline-none"
                >
                  <option value="stripe_terminal_moto" className="bg-slate-900">Stripe Terminal MOTO</option>
                  <option value="virtual_terminal" className="bg-slate-900">Virtual terminal</option>
                  <option value="phone_ach" className="bg-slate-900">Phone ACH</option>
                  <option value="bank_transfer" className="bg-slate-900">Bank transfer</option>
                  <option value="cash" className="bg-slate-900">Cash / in person</option>
                  <option value="other" className="bg-slate-900">Other</option>
                </select>
                <input
                  name="providerRef"
                  placeholder="Processor reference / auth code"
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none"
                />
                <SubmitButton tone="ok" size="sm">
                  <ShieldCheck className="h-3 w-3" /> Record Payment
                </SubmitButton>
              </form>
            </ActionDeck>
          </div>
        </SectionCard>

        <SectionCard
          title="Request Queue"
          subtitle="Assisted collections and hosted payment requests ranked for follow-up."
          className="border-amber-400/15 bg-[linear-gradient(180deg,rgba(32,20,8,0.42),rgba(13,10,21,0.92))]"
        >
          <div className="space-y-2">
            {orders.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-6 text-center text-xs text-slate-500">
                No payment requests yet.
              </p>
            ) : (
              orders.slice(0, 6).map((order) => (
                <div key={order.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={order.status} />
                        {order.tenantName && <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{order.tenantName}</span>}
                      </div>
                      <p className="mt-2 text-lg font-semibold text-white">{fmtUsd(order.total)}</p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}
                      </p>
                    </div>
                    {order.paymentLinkUrl ? (
                      <a
                        href={order.paymentLinkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200 transition hover:bg-cyan-500/20"
                      >
                        Open link
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-500">No hosted link</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <SectionCard
          title="Collections Lanes"
          subtitle="Priority buckets that tell the team where to act next."
          className="border-white/10 bg-[linear-gradient(180deg,rgba(15,18,31,0.96),rgba(10,13,25,0.98))]"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <QueueTile
              title="Overdue pressure"
              count={overdueInvoices.length}
              amount={fmtUsd(overdue)}
              detail={overdueInvoices.length ? "Invoices already demand outreach or payment capture." : "No overdue balances in this scope."}
              tone="rose"
            />
            <QueueTile
              title="Drafts waiting"
              count={draftInvoices.length}
              amount={fmtUsd(draftInvoices.reduce((acc, invoice) => acc + invoice.total, 0))}
              detail={draftInvoices.length ? "Draft invoices can be opened and collected from here." : "No draft invoices are waiting."}
              tone="amber"
            />
            <QueueTile
              title="Cash landed"
              count={paidInvoices.length}
              amount={fmtUsd(paidThisMonth)}
              detail={paidInvoices.length ? "Recently paid invoices are ready for reconciliation review." : "No paid invoices in this scope yet."}
              tone="emerald"
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Operator Notes"
          subtitle="How this workspace is meant to be used under real collections pressure."
          className="border-cyan-400/15 bg-[linear-gradient(180deg,rgba(8,31,38,0.2),rgba(10,13,25,0.98))]"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <OperatorCue
              icon={<Sparkles className="h-4 w-4 text-cyan-200" />}
              title="Stay on the call"
              body="Create a hosted payment request from the invoice itself and keep the customer moving without exposing card data in the console."
            />
            <OperatorCue
              icon={<ArrowRightLeft className="h-4 w-4 text-emerald-200" />}
              title="Reconcile fast"
              body="When money is already approved elsewhere, record it against the invoice here so status and timeline stay aligned."
            />
            <OperatorCue
              icon={<Ban className="h-4 w-4 text-rose-200" />}
              title="Control exceptions"
              body="Void mistakes and reopen work in one place instead of leaving stale billing states hanging in the system."
            />
          </div>
        </SectionCard>
      </section>

      <SectionCard
        title="Phone Payment Readiness"
        subtitle="Separate what the team can do today from what still requires Stripe Terminal MOTO enablement."
        className="mt-4 border-white/10 bg-[linear-gradient(180deg,rgba(16,18,29,0.96),rgba(10,13,25,0.98))]"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start gap-3">
              <span className="rounded-lg border border-white/10 bg-white/5 p-2">
                <Cable className="h-4 w-4 text-slate-200" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-white">Readiness Snapshot</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Hosted assisted collection is available as soon as Stripe secret key support is configured. True card entry over the phone requires Stripe Terminal MOTO approval and reader setup.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <ReadinessRow ok={readiness.assistedCollectionReady} label="Assisted hosted checkout" detail={readiness.assistedCollectionReady ? "Ready now from the Collections Workspace" : "Blocked until STRIPE_SECRET_KEY is configured"} />
              <ReadinessRow ok={readiness.stripeWebhookConfigured} label="Stripe webhook handling" detail={readiness.stripeWebhookConfigured ? "Configured" : "Add STRIPE_WEBHOOK_SECRET for tighter lifecycle sync"} />
              <ReadinessRow ok={readiness.terminalLocationConfigured} label="Terminal location mapping" detail={readiness.terminalLocationConfigured ? "Configured" : "Add STRIPE_TERMINAL_LOCATION_ID when a reader location is assigned"} />
              <ReadinessRow ok={readiness.terminalReaderConfigured} label="Terminal reader assignment" detail={readiness.terminalReaderConfigured ? "Configured" : "Add STRIPE_TERMINAL_READER_ID after reader enrollment"} />
              <ReadinessRow ok={readiness.motoFlagConfigured} label="MOTO workflow flag" detail={readiness.motoFlagConfigured ? "Enabled" : "Add STRIPE_TERMINAL_MOTO_ENABLED=true after Stripe approval"} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <InfoPanel
              icon={<CircleCheck className="h-4 w-4 text-emerald-200" />}
              title="Ready Today"
              body="Stay on the phone with the customer, generate a Stripe-hosted payment link, and guide them through secure completion without card data ever entering the admin console."
              detail="This is the recommended immediate path for collections, renewals, and one-off balances."
              tone="emerald"
            />
            <InfoPanel
              icon={<CircleAlert className="h-4 w-4 text-amber-200" />}
              title="True Phone Card Entry"
              body="For raw over-the-phone card entry, Stripe documents a Terminal MOTO flow that requires Stripe support access and supported reader hardware."
              detail="Supported readers include Stripe Reader S700/S710 and BBPOS WisePOS E."
              tone="amber"
            />
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-white">Enablement Runbook</h3>
              <ol className="mt-3 space-y-2 text-xs text-slate-300">
                <li>1. Keep using assisted hosted checkout for live collections right now.</li>
                <li>2. Request Stripe Terminal MOTO access from Stripe support.</li>
                <li>3. Enroll and assign a supported reader to your ops team.</li>
                <li>4. Set `STRIPE_TERMINAL_LOCATION_ID`, `STRIPE_TERMINAL_READER_ID`, and `STRIPE_TERMINAL_MOTO_ENABLED=true` on `app-core`.</li>
                <li>5. Add a dedicated `Terminal / MOTO` capture flow in the console once the reader is live.</li>
              </ol>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <a
                  href="https://docs.stripe.com/terminal/features/mail-telephone-orders/overview"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300 transition hover:bg-white/10"
                >
                  Stripe MOTO overview
                  <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href="https://docs.stripe.com/terminal/features/mail-telephone-orders/payments"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300 transition hover:bg-white/10"
                >
                  Stripe MOTO payments
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Invoice Radar"
          subtitle={tenant ? `Collections view for ${tenant.name}` : "Priority invoices with direct actions for follow-up, payment, and status control."}
          className="border-rose-400/12 bg-[linear-gradient(180deg,rgba(44,14,24,0.18),rgba(10,13,25,0.96))]"
        >
          <div className="space-y-3">
            {invoices.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-xs text-slate-500">
                No invoices yet.
              </p>
            ) : (
              invoices.map((invoice) => {
                const status = invoice.status.toLowerCase();
                const invoiceTenantId = invoice.tenantId || tenantId;
                const tone =
                  status === "void"
                    ? "neutral"
                    : ["open", "past_due"].includes(status)
                      ? "rose"
                      : ["paid", "captured", "succeeded"].includes(status)
                        ? "emerald"
                        : "amber";

                return (
                  <div
                    key={invoice.id}
                    className={[
                      "rounded-2xl border p-4",
                      tone === "rose"
                        ? "border-rose-400/20 bg-rose-500/[0.06]"
                        : tone === "emerald"
                          ? "border-emerald-400/20 bg-emerald-500/[0.05]"
                          : tone === "amber"
                            ? "border-amber-400/20 bg-amber-500/[0.05]"
                            : "border-white/10 bg-white/[0.03]",
                    ].join(" ")}
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={invoice.status} />
                          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                            {invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString() : "No date"}
                          </span>
                          {invoice.dueAt ? (
                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                              Due {new Date(invoice.dueAt).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <div>
                            <p className="text-2xl font-semibold text-white">{fmtUsd(invoice.total)}</p>
                            <p className="mt-1 text-[11px] text-slate-400">Invoice {invoice.id.slice(0, 8)}</p>
                          </div>
                          <div className="pb-1">
                            {invoice.tenantId ? (
                              <Link href={tenantPath(invoice.tenantId)} className="text-sm font-medium text-slate-200 transition hover:text-fuchsia-200">
                                {invoice.tenantName || invoice.tenantId}
                              </Link>
                            ) : (
                              <span className="text-sm font-medium text-slate-300">{invoice.tenantName || "Unassigned client"}</span>
                            )}
                            <p className="mt-1 text-[11px] text-slate-500">
                              {status === "past_due"
                                ? "Collections pressure is active."
                                : status === "open"
                                  ? "Ready for payment follow-up."
                                  : status === "draft"
                                    ? "Draft can be opened or turned into a request."
                                    : status === "void"
                                      ? "Voided record retained for audit."
                                      : "Cash status is already satisfied."}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:w-[420px]">
                        {invoiceTenantId ? (
                          <form action={createBillingPaymentRequest} className="contents">
                            <input type="hidden" name="tenantId" value={invoiceTenantId} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="description" value={`Invoice ${invoice.id.slice(0, 8)}`} />
                            <input type="hidden" name="amount" value={invoice.total.toFixed(2)} />
                            <input type="hidden" name="taxRatePct" value="0" />
                            <input type="hidden" name="sendLink" value="on" />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="redirectTo" value={billingScope} />
                            <SubmitButton tone="accent" size="sm" className="w-full" pendingLabel="Creating link">
                              <Receipt className="h-3 w-3" /> Request payment
                            </SubmitButton>
                          </form>
                        ) : null}

                        {invoiceTenantId ? (
                          <form action={recordProcessedPayment} className="contents">
                            <input type="hidden" name="tenantId" value={invoiceTenantId} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="amount" value={invoice.total.toFixed(2)} />
                            <input type="hidden" name="status" value="paid" />
                            <input type="hidden" name="provider" value="manual_reconciliation" />
                            <input type="hidden" name="providerRef" value={`invoice:${invoice.id}`} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="redirectTo" value={billingScope} />
                            <SubmitButton tone="ok" size="sm" className="w-full" pendingLabel="Recording payment">
                              <ShieldCheck className="h-3 w-3" /> Record full payment
                            </SubmitButton>
                          </form>
                        ) : null}

                        {invoiceTenantId && status !== "void" ? (
                          <form action={updateInvoiceStatus} className="contents">
                            <input type="hidden" name="tenantId" value={invoiceTenantId} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="nextStatus" value="void" />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="redirectTo" value={billingScope} />
                            <SubmitButton tone="bad" size="sm" className="w-full" pendingLabel="Voiding invoice">
                              <Ban className="h-3 w-3" /> Void invoice
                            </SubmitButton>
                          </form>
                        ) : null}

                        {invoiceTenantId && status === "void" ? (
                          <form action={updateInvoiceStatus} className="contents">
                            <input type="hidden" name="tenantId" value={invoiceTenantId} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="nextStatus" value="open" />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="redirectTo" value={billingScope} />
                            <SubmitButton tone="warn" size="sm" className="w-full" pendingLabel="Reopening invoice">
                              <RefreshCcw className="h-3 w-3" /> Reopen invoice
                            </SubmitButton>
                          </form>
                        ) : null}

                        {invoiceTenantId && status === "draft" ? (
                          <form action={updateInvoiceStatus} className="contents">
                            <input type="hidden" name="tenantId" value={invoiceTenantId} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="nextStatus" value="open" />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="redirectTo" value={billingScope} />
                            <SubmitButton tone="warn" size="sm" className="w-full" pendingLabel="Opening invoice">
                              <ArrowRightLeft className="h-3 w-3" /> Open for collection
                            </SubmitButton>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Cash Movement"
          subtitle={tenant ? `Recent payments for ${tenant.name}` : "Latest successful, pending, and reversed payment activity."}
          className="border-emerald-400/12 bg-[linear-gradient(180deg,rgba(11,44,34,0.16),rgba(10,13,25,0.96))]"
        >
          <div className="space-y-2">
            {payments.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-xs text-slate-500">
                No payments yet.
              </p>
            ) : (
              payments.map((payment) => (
                <div key={payment.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={payment.status} />
                        {payment.provider ? (
                          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                            {payment.provider.replaceAll("_", " ")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-lg font-semibold text-white">{fmtUsd(payment.amount)}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {payment.tenantName || payment.tenantId || "Unknown client"}
                        {payment.createdAt ? ` · ${new Date(payment.createdAt).toLocaleString()}` : ""}
                      </p>
                      {payment.providerRef ? (
                        <p className="mt-1 text-[10px] text-slate-500">Ref {payment.providerRef}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {payment.tenantId ? (
                        <Link
                          href={tenantPath(payment.tenantId)}
                          className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-white/10"
                        >
                          Open client
                        </Link>
                      ) : null}
                      {payment.invoiceId && payment.tenantId ? (
                        <Link
                          href={`/console/billing?tenantId=${encodeURIComponent(payment.tenantId)}`}
                          className="inline-flex items-center rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-500/20"
                        >
                          View invoice context
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      {tenant ? (
        <SectionCard
          title="Stored Billing Instruments"
          subtitle="Methods currently attached to this client for future billing."
          className="mt-4 border-cyan-400/12 bg-[linear-gradient(180deg,rgba(8,31,38,0.16),rgba(10,13,25,0.96))]"
        >
          <DataTable
            columns={[
              { key: "provider", header: "Provider", render: (pm) => pm.provider || "—" },
              { key: "type", header: "Type", render: (pm) => pm.type },
              { key: "brand", header: "Brand", render: (pm) => pm.brand || "—" },
              {
                key: "card",
                header: "Details",
                render: (pm) =>
                  pm.last4 ? `•••• ${pm.last4}${pm.expMonth && pm.expYear ? ` · ${String(pm.expMonth).padStart(2, "0")}/${pm.expYear}` : ""}` : "—",
              },
              { key: "status", header: "Status", render: (pm) => <StatusPill status={pm.status} /> },
            ]}
            rows={paymentMethods}
            rowKey={(pm) => pm.id}
            emptyTitle="No saved payment methods"
            emptyDescription="Use Stripe Setup Intents or a hosted checkout flow to save cards for future billing."
          />
        </SectionCard>
      ) : null}

      <SectionCard
        title="Recurring Base"
        subtitle={tenant ? `Recurring commercial footprint for ${tenant.name}` : `${subscriptions.length} subscription records in play`}
        className="mt-4 border-violet-400/12 bg-[linear-gradient(180deg,rgba(35,16,46,0.16),rgba(10,13,25,0.96))]"
      >
        <DataTable
          columns={[
            {
              key: "client",
              header: "Client",
              render: (s) =>
                s.tenantId ? (
                  <Link href={tenantPath(s.tenantId)} className="text-slate-200 transition hover:text-fuchsia-200">
                    {s.tenantName || s.tenantId}
                  </Link>
                ) : (
                  s.tenantName || "—"
                ),
            },
            { key: "plan", header: "Plan", render: (s) => s.pricingModel || "—" },
            { key: "status", header: "Status", render: (s) => <StatusPill status={s.status} /> },
            {
              key: "rate",
              header: "Rate",
              align: "right" as const,
              render: (s) => (
                <span className="font-mono text-slate-200">
                  {s.renewalRate != null ? fmtUsd(s.renewalRate) : s.originalRate != null ? fmtUsd(s.originalRate) : "—"}
                </span>
              ),
            },
          ]}
          rows={subscriptions}
          rowKey={(s) => s.id}
          emptyTitle="No subscriptions yet"
        />
      </SectionCard>
    </ConsolePageShell>
  );
}

const MetricPanel = ({
  eyebrow,
  value,
  detail,
  tone,
}: {
  eyebrow: string;
  value: string | number;
  detail: string;
  tone: "emerald" | "cyan" | "rose" | "amber" | "slate";
}) => {
  const toneMap: Record<string, string> = {
    emerald: "border-emerald-400/20 bg-emerald-500/10",
    cyan: "border-cyan-400/20 bg-cyan-500/10",
    rose: "border-rose-400/20 bg-rose-500/10",
    amber: "border-amber-400/20 bg-amber-500/10",
    slate: "border-white/10 bg-white/5",
  };

  return (
    <div className={`rounded-2xl border p-4 ${toneMap[tone]}`}>
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">{eyebrow}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="mt-1 text-[11px] text-white/70">{detail}</p>
    </div>
  );
};

const FocusStrip = ({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}) => {
  const toneMap: Record<string, string> = {
    ok: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
    warn: "border-amber-400/20 bg-amber-500/10 text-amber-200",
    bad: "border-rose-400/20 bg-rose-500/10 text-rose-200",
    neutral: "border-white/10 bg-white/5 text-slate-300",
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div>
        <p className="text-xs font-medium text-white">{label}</p>
        <p className="mt-1 text-[10px] text-slate-500">{detail}</p>
      </div>
      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${toneMap[tone]}`}>
        {value}
      </span>
    </div>
  );
};

const ActionDeck = ({
  icon,
  title,
  subtitle,
  tone,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  tone: "cyan" | "emerald";
  children: ReactNode;
}) => (
  <div
    className={[
      "rounded-2xl border p-4",
      tone === "cyan"
        ? "border-cyan-400/20 bg-[linear-gradient(180deg,rgba(12,36,47,0.48),rgba(11,15,29,0.75))]"
        : "border-emerald-400/20 bg-[linear-gradient(180deg,rgba(13,39,31,0.48),rgba(11,15,29,0.75))]",
    ].join(" ")}
  >
    <div className="flex items-start gap-3">
      <span className="rounded-xl border border-white/10 bg-white/5 p-2">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-1 text-[11px] text-slate-400">{subtitle}</p>
      </div>
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

const ReadinessRow = ({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) => (
  <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
    <span className={`mt-0.5 rounded-full p-1 ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
      {ok ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
    </span>
    <div>
      <p className="text-xs font-medium text-white">{label}</p>
      <p className="mt-1 text-[10px] text-slate-500">{detail}</p>
    </div>
  </div>
);

const InfoPanel = ({
  icon,
  title,
  body,
  detail,
  tone,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  detail: string;
  tone: "emerald" | "amber";
}) => (
  <div
    className={[
      "rounded-xl border p-4",
      tone === "emerald"
        ? "border-emerald-400/20 bg-emerald-500/5"
        : "border-amber-400/20 bg-amber-500/5",
    ].join(" ")}
  >
    <div className="flex items-start gap-3">
      <span
        className={[
          "rounded-lg border p-2",
          tone === "emerald"
            ? "border-emerald-400/30 bg-emerald-500/10"
            : "border-amber-400/30 bg-amber-500/10",
        ].join(" ")}
      >
        {icon}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-1 text-xs text-slate-300">{body}</p>
        <p className="mt-2 text-[10px] text-slate-500">{detail}</p>
      </div>
    </div>
  </div>
);

const QueueTile = ({
  title,
  count,
  amount,
  detail,
  tone,
}: {
  title: string;
  count: number;
  amount: string;
  detail: string;
  tone: "rose" | "amber" | "emerald";
}) => {
  const toneMap: Record<string, string> = {
    rose: "border-rose-400/20 bg-rose-500/[0.08]",
    amber: "border-amber-400/20 bg-amber-500/[0.08]",
    emerald: "border-emerald-400/20 bg-emerald-500/[0.08]",
  };

  return (
    <div className={`rounded-2xl border p-4 ${toneMap[tone]}`}>
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">{title}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold text-white">{count}</p>
        <p className="font-mono text-sm text-slate-200">{amount}</p>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
    </div>
  );
};

const OperatorCue = ({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
    <div className="flex items-start gap-3">
      <span className="rounded-xl border border-white/10 bg-white/5 p-2">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-1 text-[11px] leading-5 text-slate-400">{body}</p>
      </div>
    </div>
  </div>
);

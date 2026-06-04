import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadBillingData } from "../lib/modules/billing";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const { invoices, payments, subscriptions } = await loadBillingData();

  const activeSubs = subscriptions.filter((s) => ["active", "trialing"].includes(s.status));
  const mrr = activeSubs.reduce((acc, s) => acc + (s.renewalRate ?? s.originalRate ?? 0), 0);
  const overdue = invoices
    .filter((i) => ["open", "past_due"].includes(i.status.toLowerCase()))
    .reduce((acc, i) => acc + i.total, 0);
  const paidThisMonth = invoices
    .filter((i) => ["paid", "captured", "succeeded"].includes(i.status.toLowerCase()))
    .reduce((acc, i) => acc + i.total, 0);

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/billing"
      title="Billing"
      subtitle="Invoices, payments, subscriptions, and revenue rollups."
    >
      <StatsRow
        stats={[
          { label: "MRR", value: fmtUsd(mrr), sub: "monthly recurring revenue" },
          { label: "Paid (recent)", value: fmtUsd(paidThisMonth), accent: "ok" },
          { label: "Overdue", value: fmtUsd(overdue), accent: overdue > 0 ? "bad" : undefined },
          { label: "Active Subs", value: activeSubs.length },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Recent Invoices" subtitle={`Last ${invoices.length}`}>
          <DataTable
            columns={[
              { key: "date", header: "Date", render: (i) => i.createdAt ? new Date(i.createdAt).toLocaleDateString() : "—" },
              { key: "client", header: "Client", render: (i) => i.tenantName || "—" },
              { key: "status", header: "Status", render: (i) => <StatusPill status={i.status} /> },
              { key: "total", header: "Total", align: "right" as const, render: (i) => <span className="font-mono text-slate-200">{fmtUsd(i.total)}</span> },
            ]}
            rows={invoices}
            rowKey={(i) => i.id}
            emptyTitle="No invoices yet"
          />
        </SectionCard>

        <SectionCard title="Recent Payments" subtitle={`Last ${payments.length}`}>
          <DataTable
            columns={[
              { key: "date", header: "Date", render: (p) => p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—" },
              { key: "client", header: "Client", render: (p) => p.tenantName || "—" },
              { key: "status", header: "Status", render: (p) => <StatusPill status={p.status} /> },
              { key: "amount", header: "Amount", align: "right" as const, render: (p) => <span className="font-mono text-slate-200">{fmtUsd(p.amount)}</span> },
            ]}
            rows={payments}
            rowKey={(p) => p.id}
            emptyTitle="No payments yet"
          />
        </SectionCard>
      </div>

      <SectionCard title="Subscriptions" subtitle={`${subscriptions.length} total`}>
        <DataTable
          columns={[
            { key: "client", header: "Client", render: (s) => s.tenantName || "—" },
            { key: "plan", header: "Plan", render: (s) => s.pricingModel || "—" },
            { key: "status", header: "Status", render: (s) => <StatusPill status={s.status} /> },
            {
              key: "rate",
              header: "Rate",
              align: "right" as const,
              render: (s) => (
                <span className="font-mono text-slate-200">
                  {s.renewalRate != null
                    ? fmtUsd(s.renewalRate)
                    : s.originalRate != null
                      ? fmtUsd(s.originalRate)
                      : "—"}
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

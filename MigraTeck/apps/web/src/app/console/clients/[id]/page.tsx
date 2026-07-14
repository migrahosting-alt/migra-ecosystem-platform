import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Pause,
  Play,
  XCircle,
  RotateCw,
  Plus,
  Package,
  Sparkles,
  AlertTriangle,
  Pin,
  Trash2,
  UserPlus,
  Activity,
  StickyNote,
  Users,
  CircleDollarSign,
  Globe,
  Mail,
  ShieldAlert,
  MessageSquare,
  Phone,
  Pencil,
  Star,
  ExternalLink,
  Receipt,
} from "lucide-react";

import { getSession } from "../../lib/auth";
import { loadClientDetail } from "../../lib/modules/clients";
import { loadClientTimeline, describeAction } from "../../lib/modules/audit";
import { loadClientNotes } from "../../lib/modules/notes";
import { loadClientContacts, CONTACT_ROLES } from "../../lib/modules/contacts";
import { loadFailedTasksForTenant } from "../../lib/modules/failed-tasks";
import { loadSupportData } from "../../lib/modules/support";
import { loadRecentOrdersForTenant } from "../../lib/modules/orders";
import {
  pauseSite,
  resumeSite,
  triggerDeploy,
  triggerBackup,
} from "../../lib/modules/hosting-server-actions";
import {
  isActiveTenant,
  isSuspendedTenant,
  isChurnedTenant,
  SUBSCRIPTION_STATUS,
} from "../../lib/modules/status";
import {
  activateClient,
  suspendClient,
  cancelClient,
  resumeClient,
  renewClient,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  renewSubscription,
  addNote,
  removeNote,
  togglePinAction,
  addContact,
  updateContact,
  makePrimaryContact,
  removeContact,
  createPaymentRequest,
  setDomainStatus,
  toggleDomainAutorenew,
  setMailboxStatus,
} from "../../lib/modules/client-actions";
import {
  addServicePath,
  addProductPath,
  addAddonPath,
  editTenantPath,
  editDomainPath,
  editMailboxPath,
  hostingSitePath,
  clientDomainCreatePath,
  clientMailboxCreatePath,
  clientHostingCreatePath,
  clientBillingPath,
  clientSupportPath,
  clientActivityPath,
  clientNewTicketPath,
} from "../../lib/urls";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { SectionCard } from "../../components/SectionCard";
import { DataTable, StatusPill } from "../../components/DataTable";
import { ConfirmActionForm } from "../../components/ConfirmActionForm";
import { SubmitButton } from "../../components/SubmitButton";

export const dynamic = "force-dynamic";

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const { id } = await params;
  const [client, timeline, notes, contacts, failedTasks, support, orders] = await Promise.all([
    loadClientDetail(id),
    loadClientTimeline(id, 50),
    loadClientNotes(id),
    loadClientContacts(id),
    loadFailedTasksForTenant(id, 10),
    loadSupportData({ tenantId: id }),
    loadRecentOrdersForTenant(id, 8),
  ]);
  if (!client) notFound();

  const active = isActiveTenant(client.status);
  const suspended = isSuspendedTenant(client.status);
  const churned = isChurnedTenant(client.status);
  const suggestedDomain = client.domains[0]?.domain || client.websites[0]?.domain || null;
  const primaryContact = contacts.find((contact) => contact.isDefault) || contacts[0] || null;
  const activeSubscriptions = client.subscriptions.filter((sub) => sub.status === SUBSCRIPTION_STATUS.active).length;
  const recurringRevenue = client.subscriptions.reduce((sum, sub) => {
    if (sub.status === SUBSCRIPTION_STATUS.cancelled) return sum;
    const value = sub.renewalRate ?? sub.originalRate ?? 0;
    return sum + value;
  }, 0);
  const outstandingInvoices = client.invoices.filter((invoice) =>
    ["open", "past_due", "draft"].includes(invoice.status.toLowerCase()),
  );
  const openTickets = support.tickets.filter((ticket) => !["closed", "resolved"].includes(ticket.status.toLowerCase()));
  const linkedOrders = orders.filter((order) => !!order.paymentLinkUrl);
  const snapshotCards = [
    {
      label: "Active services",
      value: `${activeSubscriptions}`,
      detail: `${client.subscriptions.length} subscription record(s)`,
      tone: "border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-100",
      icon: Sparkles,
    },
    {
      label: "Recurring revenue",
      value: fmtUsd(recurringRevenue),
      detail: outstandingInvoices.length ? `${outstandingInvoices.length} invoice(s) awaiting action` : "No overdue invoice pressure",
      tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-100",
      icon: CircleDollarSign,
    },
    {
      label: "Primary domain",
      value: suggestedDomain || "Not assigned",
      detail: `${client.domains.length} domain(s) · ${client.websites.length} site(s)`,
      tone: "border-sky-400/20 bg-sky-500/10 text-sky-100",
      icon: Globe,
    },
    {
      label: "Primary contact",
      value: primaryContact?.name || primaryContact?.email || "Needs owner",
      detail: primaryContact?.title || primaryContact?.phone || "Assign a billing or technical lead",
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-100",
      icon: Users,
    },
    {
      label: "Support workload",
      value: `${openTickets.length} open`,
      detail: openTickets[0]?.subject || "No active tickets",
      tone: "border-violet-400/20 bg-violet-500/10 text-violet-100",
      icon: MessageSquare,
    },
    {
      label: "Payment requests",
      value: `${linkedOrders.length} active`,
      detail: orders[0]?.paymentLinkUrl ? "Latest link ready to send" : "Use quick billing to request payment",
      tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-100",
      icon: Receipt,
    },
    {
      label: "Provisioning risk",
      value: failedTasks.length ? `${failedTasks.length} blocked` : "Clear",
      detail: failedTasks.length ? "Ops follow-up required" : "No failed background tasks",
      tone: failedTasks.length
        ? "border-rose-400/20 bg-rose-500/10 text-rose-100"
        : "border-teal-400/20 bg-teal-500/10 text-teal-100",
      icon: failedTasks.length ? ShieldAlert : Play,
    },
  ];

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/clients"
      title={client.name}
      subtitle={`${client.tenantType} · ${client.status}${
        client.createdAt ? ` · Joined ${new Date(client.createdAt).toLocaleDateString()}` : ""
      }`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/console/clients"
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <Link
            href={editTenantPath(id)}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
          >
            Edit profile
          </Link>
          <StatusPill status={client.status} />
        </div>
      }
    >
      {failedTasks.length > 0 && (
        <SectionCard
          title={
            <span className="flex items-center gap-2 text-rose-200">
              <AlertTriangle className="h-4 w-4" />
              {failedTasks.length} provisioning task{failedTasks.length === 1 ? "" : "s"} need{failedTasks.length === 1 ? "s" : ""} attention
            </span>
          }
        >
          <div className="space-y-2">
            {failedTasks.map((t) => (
              <div key={t.id} className="rounded-lg border border-rose-400/30 bg-rose-500/5 p-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-rose-200">{t.type}</p>
                    <p className="text-[10px] text-slate-400">
                      {t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"} · status: {t.status}
                    </p>
                  </div>
                  <span className="rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-200">
                    {t.status}
                  </span>
                </div>
                {t.error && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded bg-slate-950/60 p-2 text-[10px] text-rose-300/80">
                    {t.error}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Account snapshot"
        subtitle="The fastest way to understand account health, ownership, and next action."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snapshotCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className={`rounded-xl border p-3 ${card.tone}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">{card.label}</p>
                    <p className="mt-2 text-lg font-semibold text-white">{card.value}</p>
                    <p className="mt-1 text-xs text-white/70">{card.detail}</p>
                  </div>
                  <span className="rounded-lg border border-white/10 bg-slate-950/20 p-2">
                    <Icon className="h-4 w-4 text-white/80" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Account lifecycle"
        subtitle="Activate, suspend, cancel, resume, or renew. Destructive actions require a typed confirmation and capture a reason."
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {!active && !churned && (
            <form action={activateClient}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton tone="ok">
                <Play className="h-3.5 w-3.5" /> Activate
              </SubmitButton>
            </form>
          )}

          {active && (
            <ConfirmActionForm
              action={suspendClient}
              hidden={{ id }}
              trigger={{ label: "Suspend", icon: <Pause className="h-3.5 w-3.5" />, tone: "warn" }}
              title="Suspend this client?"
              description="All active subscriptions will be paused. Data is preserved. The client retains login access but cannot use paid features."
              reasonRequired
              reasonLabel="Reason for suspension"
              reasonPlaceholder="e.g. Non-payment 30 days, abuse complaint, customer requested hold"
              submitLabel="Suspend"
              submitTone="warn"
            />
          )}

          {suspended && (
            <form action={resumeClient}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton tone="ok">
                <Play className="h-3.5 w-3.5" /> Resume
              </SubmitButton>
            </form>
          )}

          {!churned && (
            <ConfirmActionForm
              action={cancelClient}
              hidden={{ id }}
              trigger={{ label: "Cancel", icon: <XCircle className="h-3.5 w-3.5" />, tone: "bad" }}
              title="Cancel this client?"
              description={
                <>
                  This <strong className="text-rose-300">churns the tenant</strong> and cancels every
                  active/paused subscription. The tenant is soft-deleted but recoverable.
                </>
              }
              confirmPhrase={client.name}
              confirmHint="Type the client's exact name to enable the Cancel button."
              reasonRequired
              reasonLabel="Reason for cancellation"
              reasonPlaceholder="e.g. Voluntary churn, business closed, switched providers"
              submitLabel="Cancel client"
              submitTone="bad"
            />
          )}

          {churned && (
            <form action={activateClient}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton tone="ok">
                <RotateCw className="h-3.5 w-3.5" /> Reactivate
              </SubmitButton>
            </form>
          )}

          {active && (
            <form action={renewClient}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton tone="accent">
                <RotateCw className="h-3.5 w-3.5" /> Renew all
              </SubmitButton>
            </form>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Add to this account">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Link
            href={addServicePath(id)}
            className="flex items-center gap-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-2 text-xs font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Add subscription / service
          </Link>
          <Link
            href={addProductPath(id)}
            className="flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-200 transition hover:bg-violet-500/20"
          >
            <Package className="h-3.5 w-3.5" />
            Add one-time product
          </Link>
          <Link
            href={addAddonPath(id)}
            className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Add addon to subscription
          </Link>
        </div>
      </SectionCard>

      <SectionCard
        title="Workspace shortcuts"
        subtitle="Jump directly into the modules that operate this client."
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Link
            href={clientBillingPath(id)}
            className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-center text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20"
          >
            Billing
          </Link>
          <Link
            href={clientDomainCreatePath(id)}
            className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-center text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
          >
            Add Domain
          </Link>
          <Link
            href={clientMailboxCreatePath(id)}
            className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-center text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20"
          >
            Add Mailbox
          </Link>
          <Link
            href={clientHostingCreatePath(id, suggestedDomain)}
            className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-center text-xs font-medium text-sky-200 transition hover:bg-sky-500/20"
          >
            Add Hosting
          </Link>
          <Link
            href={clientSupportPath(id)}
            className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
          >
            Support
          </Link>
          <Link
            href={clientActivityPath(id)}
            className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-2 text-center text-xs font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20"
          >
            Activity
          </Link>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Subscriptions" subtitle={`${client.subscriptions.length} record(s)`}>
          <DataTable
            columns={[
              { key: "plan", header: "Plan", render: (s) => s.pricingModel || "—" },
              { key: "status", header: "Status", render: (s) => <StatusPill status={s.status} /> },
              {
                key: "rate",
                header: "Rate",
                align: "right",
                render: (s) =>
                  s.renewalRate != null
                    ? fmtUsd(s.renewalRate)
                    : s.originalRate != null
                      ? fmtUsd(s.originalRate)
                      : "—",
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (s) => (
                  <div className="inline-flex items-center gap-1">
                    {s.status === SUBSCRIPTION_STATUS.active && (
                      <form action={pauseSubscription} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="subId" value={s.id} />
                        <SubmitButton tone="warn" size="sm">Pause</SubmitButton>
                      </form>
                    )}
                    {s.status === SUBSCRIPTION_STATUS.paused && (
                      <form action={resumeSubscription} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="subId" value={s.id} />
                        <SubmitButton tone="ok" size="sm">Resume</SubmitButton>
                      </form>
                    )}
                    {s.status !== SUBSCRIPTION_STATUS.cancelled && (
                      <form action={renewSubscription} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="subId" value={s.id} />
                        <SubmitButton tone="accent" size="sm">Renew</SubmitButton>
                      </form>
                    )}
                    {s.status !== SUBSCRIPTION_STATUS.cancelled && (
                      <ConfirmActionForm
                        action={cancelSubscription}
                        hidden={{ tenantId: id, subId: s.id }}
                        trigger={{ label: "Cancel", tone: "bad", size: "sm" }}
                        title="Cancel this subscription?"
                        description="Billing stops at the end of the current period. The subscription record is preserved with status='cancelled'."
                        reasonRequired
                        reasonLabel="Reason"
                        reasonPlaceholder="e.g. Downgrade, replaced by other plan, customer requested"
                        submitLabel="Cancel sub"
                      />
                    )}
                  </div>
                ),
              },
            ]}
            rows={client.subscriptions}
            rowKey={(s) => s.id}
            emptyTitle="No subscriptions"
            emptyDescription="Add a subscription via the toolbar above."
          />
        </SectionCard>

        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-fuchsia-300" />
              Activity timeline
            </span>
          }
          subtitle={`${timeline.length} recent event(s)`}
          actions={
            <Link href={clientActivityPath(id)} className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200">
              View All Activity
            </Link>
          }
        >
          {timeline.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-slate-500">
              No events recorded yet. Lifecycle actions, notes, and contact changes will appear here.
            </p>
          ) : (
            <ol className="space-y-2 max-h-96 overflow-auto pr-1">
              {timeline.map((e) => (
                <li
                  key={e.id}
                  className={`rounded-lg border p-2.5 text-xs ${
                    e.result === "failure"
                      ? "border-rose-400/30 bg-rose-500/5"
                      : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={
                        e.result === "failure" ? "font-semibold text-rose-200" : "font-semibold text-slate-200"
                      }
                    >
                      {describeAction(e.action)}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {e.actorEmail || "system"}
                    {e.resource && <> · {e.resource}{e.resourceId ? ` (${e.resourceId.slice(0, 8)})` : ""}</>}
                  </div>
                  {e.reason && (
                    <p className="mt-1.5 rounded bg-slate-950/40 p-1.5 text-[10px] text-slate-300">
                      “{e.reason}”
                    </p>
                  )}
                  {e.error && (
                    <pre className="mt-1.5 max-h-20 overflow-auto rounded bg-rose-950/40 p-1.5 text-[10px] text-rose-300">
                      {e.error}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-amber-300" />
              Internal notes
            </span>
          }
          subtitle="Private to ops — never shown to the client."
        >
          <form action={addNote} className="mb-3 space-y-2">
            <input type="hidden" name="tenantId" value={id} />
            <textarea
              name="body"
              required
              rows={3}
              placeholder="Add a note about this client (payment arrangements, watch-outs, context)…"
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-amber-400/40 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[10px] text-slate-400">
                <input type="checkbox" name="pinned" className="rounded border-white/20 bg-white/5" />
                Pin to top
              </label>
              <SubmitButton tone="default" size="sm">Add note</SubmitButton>
            </div>
          </form>

          {notes.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-slate-500">No notes yet.</p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-auto pr-1">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className={`rounded-lg border p-2.5 ${
                    n.pinned ? "border-amber-400/40 bg-amber-500/5" : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-xs whitespace-pre-wrap text-slate-200">{n.body}</p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {n.authorEmail || "unknown"} · {n.createdAt ? new Date(n.createdAt).toLocaleString() : "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <form action={togglePinAction} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="noteId" value={n.id} />
                        <input type="hidden" name="pinned" value={n.pinned ? "0" : "1"} />
                        <SubmitButton tone={n.pinned ? "warn" : "ghost"} size="sm" title={n.pinned ? "Unpin" : "Pin"}>
                          <Pin className="h-3 w-3" />
                        </SubmitButton>
                      </form>
                      <form action={removeNote} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="noteId" value={n.id} />
                        <SubmitButton tone="bad" size="sm" title="Delete note">
                          <Trash2 className="h-3 w-3" />
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-300" />
              Contacts
            </span>
          }
          subtitle={`${contacts.length} contact(s) — billing, technical, escalation`}
        >
          <form action={addContact} className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <input type="hidden" name="tenantId" value={id} />
            <select
              name="role"
              defaultValue="primary"
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white focus:border-emerald-400/40 focus:outline-none"
            >
              {CONTACT_ROLES.map((r) => (
                <option key={r} value={r} className="bg-slate-900">{r}</option>
              ))}
            </select>
            <input
              name="name"
              placeholder="Name"
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none"
            />
            <input
              name="email"
              type="email"
              placeholder="email@…"
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none"
            />
            <input
              name="phone"
              placeholder="Phone"
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none"
            />
            <input
              name="title"
              placeholder="Title (CEO, CFO, IT lead…)"
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none md:col-span-2"
            />
            <textarea
              name="notes"
              rows={2}
              placeholder="Contact notes, hours, escalation instructions…"
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none md:col-span-2"
            />
            <label className="flex items-center gap-2 text-[10px] text-slate-400 md:col-span-2">
              <input type="checkbox" name="isDefault" className="rounded border-white/20 bg-white/5" />
              Set as primary contact
            </label>
            <div className="md:col-span-2 flex justify-end">
              <SubmitButton tone="ok" size="sm">
                <UserPlus className="h-3 w-3" /> Add contact
              </SubmitButton>
            </div>
          </form>

          {contacts.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-slate-500">No contacts yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-200">
                          {c.role}
                        </span>
                        {c.isDefault && (
                          <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-200">
                            Primary
                          </span>
                        )}
                        <p className="text-xs font-semibold text-white">{c.name || "(unnamed)"}</p>
                      </div>
                      {c.title && <p className="text-[10px] text-slate-400">{c.title}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-300">
                        {c.email && (
                          <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 transition hover:bg-white/10">
                            <Mail className="h-3 w-3" />
                            {c.email}
                          </a>
                        )}
                        {c.phone && (
                          <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 transition hover:bg-white/10">
                            <Phone className="h-3 w-3" />
                            {c.phone}
                          </a>
                        )}
                      </div>
                      {c.notes && <p className="mt-2 rounded-md bg-slate-950/30 p-2 text-[10px] text-slate-400">{c.notes}</p>}
                      <details className="mt-2">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10">
                          <Pencil className="h-3 w-3" />
                          Edit contact
                        </summary>
                        <form action={updateContact} className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <input type="hidden" name="tenantId" value={id} />
                          <input type="hidden" name="id" value={c.id} />
                          <select
                            name="role"
                            defaultValue={c.role}
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white focus:border-emerald-400/40 focus:outline-none"
                          >
                            {CONTACT_ROLES.map((r) => (
                              <option key={r} value={r} className="bg-slate-900">{r}</option>
                            ))}
                          </select>
                          <input
                            name="name"
                            defaultValue={c.name || ""}
                            placeholder="Name"
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none"
                          />
                          <input
                            name="email"
                            type="email"
                            defaultValue={c.email || ""}
                            placeholder="email@…"
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none"
                          />
                          <input
                            name="phone"
                            defaultValue={c.phone || ""}
                            placeholder="Phone"
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none"
                          />
                          <input
                            name="title"
                            defaultValue={c.title || ""}
                            placeholder="Title"
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none md:col-span-2"
                          />
                          <textarea
                            name="notes"
                            defaultValue={c.notes || ""}
                            rows={2}
                            placeholder="Notes"
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none md:col-span-2"
                          />
                          <label className="flex items-center gap-2 text-[10px] text-slate-400 md:col-span-2">
                            <input
                              type="checkbox"
                              name="isDefault"
                              defaultChecked={c.isDefault}
                              className="rounded border-white/20 bg-white/5"
                            />
                            Keep as primary contact
                          </label>
                          <div className="md:col-span-2 flex justify-end">
                            <SubmitButton tone="ok" size="sm">Save contact</SubmitButton>
                          </div>
                        </form>
                      </details>
                    </div>
                    <div className="flex items-center gap-1">
                      {!c.isDefault && (
                        <form action={makePrimaryContact} className="inline">
                          <input type="hidden" name="tenantId" value={id} />
                          <input type="hidden" name="id" value={c.id} />
                          <SubmitButton tone="accent" size="sm" title="Make primary contact">
                            <Star className="h-3 w-3" />
                          </SubmitButton>
                        </form>
                      )}
                      <form action={removeContact} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="id" value={c.id} />
                        <SubmitButton tone="bad" size="sm" title="Remove contact">
                          <Trash2 className="h-3 w-3" />
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Quick billing"
          subtitle="Create an ad-hoc payment request from the client workspace and keep recent requests close by."
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <form action={createPaymentRequest} className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input type="hidden" name="tenantId" value={id} />
              <input
                name="description"
                required
                placeholder="What is this charge for?"
                className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none md:col-span-2"
              />
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                placeholder="Amount (USD)"
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
              <label className="flex items-center gap-2 text-[10px] text-slate-400 md:col-span-2">
                <input type="checkbox" name="sendLink" defaultChecked className="rounded border-white/20 bg-white/5" />
                Generate Stripe payment link when billing credentials are configured
              </label>
              <div className="md:col-span-2 flex items-center justify-between gap-3">
                <p className="text-[10px] text-slate-500">
                  Creates an order record and, when available, a live payment link your team can send immediately.
                </p>
                <SubmitButton tone="accent" size="sm">
                  <Receipt className="h-3 w-3" /> Create request
                </SubmitButton>
              </div>
            </form>

            <div className="space-y-2">
              {orders.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-6 text-center text-xs text-slate-500">
                  No payment requests yet. Use the form to create the first one.
                </p>
              ) : (
                orders.map((order) => (
                  <div key={order.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={order.status} />
                          {order.paymentLinkUrl ? (
                            <span className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-cyan-200">
                              Link ready
                            </span>
                          ) : (
                            <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-400">
                              Draft only
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs font-semibold text-white">{fmtUsd(order.total)}</p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}
                          {order.taxAmount > 0 ? ` · includes ${fmtUsd(order.taxAmount)} tax` : ""}
                        </p>
                      </div>
                      {order.paymentLinkUrl ? (
                        <a
                          href={order.paymentLinkUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-300 transition hover:text-cyan-200"
                        >
                          Open link
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent Invoices"
          subtitle={`Last ${client.invoices.length}`}
          actions={
            <Link href={clientBillingPath(id)} className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200">
              Open Billing
            </Link>
          }
        >
          <DataTable
            columns={[
              {
                key: "date",
                header: "Date",
                render: (i) => (i.createdAt ? new Date(i.createdAt).toLocaleDateString() : "—"),
              },
              { key: "status", header: "Status", render: (i) => <StatusPill status={i.status} /> },
              {
                key: "total",
                header: "Total",
                align: "right",
                render: (i) => <span className="font-mono text-slate-200">{fmtUsd(i.total)}</span>,
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: () => (
                  <Link href={clientBillingPath(id)} className="text-[11px] font-medium text-fuchsia-300 transition hover:text-fuchsia-200">
                    View
                  </Link>
                ),
              },
            ]}
            rows={client.invoices}
            rowKey={(i) => i.id}
            emptyTitle="No invoices"
          />
        </SectionCard>

        <SectionCard
          title="Domains"
          subtitle={`${client.domains.length} domain(s)`}
          actions={
            <Link href={clientDomainCreatePath(id)} className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200">
              Add Domain
            </Link>
          }
        >
          <DataTable
            columns={[
              {
                key: "domain",
                header: "Domain",
                render: (d) => (
                  <Link href={editDomainPath(d.id)} className="font-medium text-white transition hover:text-fuchsia-200">
                    {d.domain}
                  </Link>
                ),
              },
              { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
              {
                key: "renew",
                header: "Renewal",
                render: (d) => (
                  <form action={toggleDomainAutorenew} className="inline">
                    <input type="hidden" name="tenantId" value={id} />
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="autorenew" value={d.autorenew ? "false" : "true"} />
                    <SubmitButton tone={d.autorenew ? "ok" : "ghost"} size="sm">
                      {d.autorenew ? "Auto-renew on" : "Auto-renew off"}
                    </SubmitButton>
                  </form>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (d) => (
                  <div className="flex justify-end gap-1">
                    {d.status === "suspended" ? (
                      <form action={setDomainStatus} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="status" value="active" />
                        <SubmitButton tone="ok" size="sm">Activate</SubmitButton>
                      </form>
                    ) : (
                      <form action={setDomainStatus} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="status" value="suspended" />
                        <SubmitButton tone="warn" size="sm">Suspend</SubmitButton>
                      </form>
                    )}
                    <Link href={editDomainPath(d.id)} className="text-[11px] font-medium text-fuchsia-300 transition hover:text-fuchsia-200">
                      Manage
                    </Link>
                  </div>
                ),
              },
            ]}
            rows={client.domains}
            rowKey={(d) => d.id}
            emptyTitle="No domains"
          />
        </SectionCard>

        <SectionCard
          title="Mailboxes"
          subtitle={`${client.mailboxes.length} mailbox(es)`}
          actions={
            <Link href={clientMailboxCreatePath(id)} className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200">
              Add Mailbox
            </Link>
          }
        >
          <DataTable
            columns={[
              {
                key: "address",
                header: "Address",
                render: (m) => (
                  <div>
                    <Link href={editMailboxPath(m.id)} className="text-slate-200 transition hover:text-fuchsia-200">
                      {m.address}
                    </Link>
                    <p className="text-[10px] text-slate-500">{m.hasPassword ? "Password set" : "Needs password before activation"}</p>
                  </div>
                ),
              },
              { key: "status", header: "Status", render: (m) => <StatusPill status={m.status} /> },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (m) => (
                  <div className="flex justify-end gap-1">
                    {m.status === "active" ? (
                      <form action={setMailboxStatus} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="status" value="suspended" />
                        <SubmitButton tone="warn" size="sm">Suspend</SubmitButton>
                      </form>
                    ) : !m.hasPassword ? (
                      <Link href={editMailboxPath(m.id)} className="text-[11px] font-medium text-amber-300 transition hover:text-amber-200">
                        Set password
                      </Link>
                    ) : (
                      <form action={setMailboxStatus} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="status" value="active" />
                        <SubmitButton tone="ok" size="sm">Activate</SubmitButton>
                      </form>
                    )}
                    {m.status !== "disabled" && (
                      <form action={setMailboxStatus} className="inline">
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="status" value="disabled" />
                        <SubmitButton tone="bad" size="sm">Disable</SubmitButton>
                      </form>
                    )}
                    <Link href={editMailboxPath(m.id)} className="text-[11px] font-medium text-fuchsia-300 transition hover:text-fuchsia-200">
                      Manage
                    </Link>
                  </div>
                ),
              },
            ]}
            rows={client.mailboxes}
            rowKey={(m) => m.id}
            emptyTitle="No mailboxes"
          />
        </SectionCard>

        <SectionCard
          title="Websites"
          subtitle={`${client.websites.length} site(s)`}
          className="lg:col-span-2"
          actions={
            <Link href={clientHostingCreatePath(id, suggestedDomain)} className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200">
              Add Hosting
            </Link>
          }
        >
          <DataTable
            columns={[
              {
                key: "domain",
                header: "Domain",
                render: (w) => (
                  <Link href={hostingSitePath(w.id)} className="text-white transition hover:text-fuchsia-200">
                    {w.domain || w.id}
                  </Link>
                ),
              },
              { key: "status", header: "Status", render: (w) => <StatusPill status={w.status} /> },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (w) => (
                  <div className="flex justify-end gap-1">
                    {w.status === "active" ? (
                      <form action={pauseSite} className="inline">
                        <input type="hidden" name="id" value={w.id} />
                        <input type="hidden" name="tenantId" value={id} />
                        <SubmitButton tone="warn" size="sm">Suspend</SubmitButton>
                      </form>
                    ) : (
                      <form action={resumeSite} className="inline">
                        <input type="hidden" name="id" value={w.id} />
                        <input type="hidden" name="tenantId" value={id} />
                        <SubmitButton tone="ok" size="sm">Resume</SubmitButton>
                      </form>
                    )}
                    <form action={triggerDeploy} className="inline">
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="tenantId" value={id} />
                      <SubmitButton tone="accent" size="sm">Deploy</SubmitButton>
                    </form>
                    <form action={triggerBackup} className="inline">
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="tenantId" value={id} />
                      <SubmitButton size="sm">Backup</SubmitButton>
                    </form>
                    <Link href={hostingSitePath(w.id)} className="text-[11px] font-medium text-fuchsia-300 transition hover:text-fuchsia-200">
                      Manage
                    </Link>
                  </div>
                ),
              },
            ]}
            rows={client.websites}
            rowKey={(w) => w.id}
            emptyTitle="No websites yet"
            emptyDescription="When this client provisions hosting, sites appear here."
          />
        </SectionCard>

        <SectionCard
          title="Support"
          subtitle={`${openTickets.length} open ticket(s) · Keep triage close to the client record.`}
          actions={
            <Link href={clientSupportPath(id)} className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200">
              View Support
            </Link>
          }
          >
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Link
                href={clientNewTicketPath(id)}
                className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
              >
                Open Ticket
              </Link>
              <Link
                href={clientSupportPath(id)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-xs font-medium text-slate-300 transition hover:bg-white/10"
              >
                Ticket Queue
              </Link>
            </div>
            {support.tickets.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-4 text-center text-xs text-slate-500">
                No tickets yet. Launch the first request directly from this workspace.
              </p>
            ) : (
              <div className="space-y-2">
                {support.tickets.slice(0, 4).map((ticket) => (
                  <div key={ticket.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={ticket.status} />
                          {ticket.priority && <StatusPill status={ticket.priority} variant="warn" />}
                        </div>
                        <p className="mt-2 truncate text-xs font-semibold text-white">{ticket.subject || "Untitled ticket"}</p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {ticket.assigneeName || "Unassigned"} · {ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : "—"}
                        </p>
                      </div>
                      <Link
                        href={`/console/support/${ticket.id}/edit`}
                        className="text-[11px] font-medium text-fuchsia-300 transition hover:text-fuchsia-200"
                      >
                        Open
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}

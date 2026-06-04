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
} from "lucide-react";

import { getSession } from "../../lib/auth";
import { loadClientDetail } from "../../lib/modules/clients";
import { loadClientTimeline, describeAction } from "../../lib/modules/audit";
import { loadClientNotes } from "../../lib/modules/notes";
import { loadClientContacts, CONTACT_ROLES } from "../../lib/modules/contacts";
import { loadFailedTasksForTenant } from "../../lib/modules/failed-tasks";
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
  removeContact,
} from "../../lib/modules/client-actions";
import {
  addServicePath,
  addProductPath,
  addAddonPath,
  editTenantPath,
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
  const [client, timeline, notes, contacts, failedTasks] = await Promise.all([
    loadClientDetail(id),
    loadClientTimeline(id, 50),
    loadClientNotes(id),
    loadClientContacts(id),
    loadFailedTasksForTenant(id, 10),
  ]);
  if (!client) notFound();

  const active = isActiveTenant(client.status);
  const suspended = isSuspendedTenant(client.status);
  const churned = isChurnedTenant(client.status);

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
                        <p className="text-xs font-semibold text-white">{c.name || "(unnamed)"}</p>
                      </div>
                      {c.title && <p className="text-[10px] text-slate-400">{c.title}</p>}
                      <p className="mt-1 text-[10px] text-slate-300 space-x-2">
                        {c.email && <span>📧 {c.email}</span>}
                        {c.phone && <span>📞 {c.phone}</span>}
                      </p>
                    </div>
                    <form action={removeContact} className="inline">
                      <input type="hidden" name="tenantId" value={id} />
                      <input type="hidden" name="id" value={c.id} />
                      <SubmitButton tone="bad" size="sm" title="Remove contact">
                        <Trash2 className="h-3 w-3" />
                      </SubmitButton>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent Invoices" subtitle={`Last ${client.invoices.length}`}>
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
            ]}
            rows={client.invoices}
            rowKey={(i) => i.id}
            emptyTitle="No invoices"
          />
        </SectionCard>

        <SectionCard title="Domains" subtitle={`${client.domains.length} domain(s)`}>
          <DataTable
            columns={[
              { key: "domain", header: "Domain", render: (d) => <span className="font-medium text-white">{d.domain}</span> },
              { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
            ]}
            rows={client.domains}
            rowKey={(d) => d.id}
            emptyTitle="No domains"
          />
        </SectionCard>

        <SectionCard title="Mailboxes" subtitle={`${client.mailboxes.length} mailbox(es)`}>
          <DataTable
            columns={[
              { key: "address", header: "Address", render: (m) => <span className="text-slate-200">{m.address}</span> },
              { key: "status", header: "Status", render: (m) => <StatusPill status={m.status} /> },
            ]}
            rows={client.mailboxes}
            rowKey={(m) => m.id}
            emptyTitle="No mailboxes"
          />
        </SectionCard>

        <SectionCard title="Websites" subtitle={`${client.websites.length} site(s)`} className="lg:col-span-2">
          <DataTable
            columns={[
              { key: "domain", header: "Domain", render: (w) => w.domain || w.id },
              { key: "status", header: "Status", render: (w) => <StatusPill status={w.status} /> },
            ]}
            rows={client.websites}
            rowKey={(w) => w.id}
            emptyTitle="No websites yet"
            emptyDescription="When this client provisions hosting, sites appear here."
          />
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { MessageSquareText, ShieldAlert, UserRound, Clock3 } from "lucide-react";

import { getSession } from "../../../lib/auth";
import { loadSupportTicketDetail } from "../../../lib/modules/support";
import {
  addInternalTicketNote,
  closeTicket,
  loadSupportAgentsForForm,
  updateTicketDetail,
} from "../../../lib/modules/support-actions";
import { tenantPath } from "../../../lib/urls";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";
import { SectionCard } from "../../../components/SectionCard";
import { StatusPill } from "../../../components/DataTable";
import { SubmitButton } from "../../../components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function EditTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { id } = await params;
  const sp = await searchParams;
  const detail = await loadSupportTicketDetail(id);
  if (!detail) notFound();

  const agents = await loadSupportAgentsForForm();
  const { ticket, messages } = detail;
  const returnTo = (sp.returnTo || "").trim() || (ticket.tenantId ? tenantPath(ticket.tenantId) : "/console/support");
  const tagsValue = ticket.tags.join(", ");

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/support"
      title={ticket.subject || "Untitled ticket"}
      subtitle={[
        ticket.ticketNumber || ticket.id.slice(0, 8),
        ticket.tenantName ? `Client: ${ticket.tenantName}` : null,
        ticket.customerEmail || ticket.customerName || null,
      ].filter(Boolean).join(" · ")}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href={returnTo}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
          >
            Back
          </Link>
          <StatusPill status={ticket.status} />
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <div className="space-y-4">
          <FormShell
            backHref={returnTo}
            backLabel="Back"
            title="Ticket workspace"
            description="Update routing, ownership, customer context, and queue state from one place."
            error={sp.error || null}
            action={updateTicketDetail}
            submitLabel="Save Ticket"
          >
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="redirectTo" value={returnTo} />
            <Field label="Subject" name="subject" required defaultValue={ticket.subject || ""} />
            <Field
              label="Department"
              name="department"
              type="select"
              defaultValue={ticket.department || "Support"}
              options={[
                { value: "Support", label: "Support" },
                { value: "Billing", label: "Billing" },
                { value: "Hosting", label: "Hosting" },
                { value: "Email", label: "Email" },
                { value: "Security", label: "Security" },
              ]}
            />
            <Field
              label="Status"
              name="status"
              type="select"
              defaultValue={ticket.status}
              options={[
                { value: "open", label: "Open" },
                { value: "pending", label: "Pending" },
                { value: "in_progress", label: "In Progress" },
                { value: "resolved", label: "Resolved" },
                { value: "closed", label: "Closed" },
              ]}
            />
            <Field
              label="Priority"
              name="priority"
              type="select"
              defaultValue={ticket.priority || "normal"}
              options={[
                { value: "low", label: "Low" },
                { value: "normal", label: "Normal" },
                { value: "high", label: "High" },
                { value: "critical", label: "Critical" },
              ]}
            />
            <Field label="Customer Name" name="customerName" defaultValue={ticket.customerName || ""} />
            <Field label="Customer Email" name="customerEmail" type="email" defaultValue={ticket.customerEmail || ""} />
            <Field
              label="Assignee"
              name="assignedTo"
              type="select"
              defaultValue={ticket.assigneeId || ""}
              options={[{ value: "", label: "Unassigned" }, ...agents.map((agent) => ({ value: agent.id, label: agent.name }))]}
            />
            <Field
              label="Tags"
              name="tags"
              defaultValue={tagsValue}
              placeholder="urgent, migration, refund"
              hint="Comma-separated routing or reporting tags."
            />
          </FormShell>

          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-cyan-300" />
                Ticket Activity
              </span>
            }
            subtitle={`${messages.length} message(s) logged`}
          >
            <form action={addInternalTicketNote} className="mb-4 space-y-2">
              <input type="hidden" name="ticketId" value={id} />
              <input type="hidden" name="redirectTo" value={`/console/support/${id}/edit?returnTo=${encodeURIComponent(returnTo)}`} />
              <textarea
                name="body"
                required
                rows={3}
                placeholder="Add an internal update, handoff note, or triage summary…"
                className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
              />
              <div className="flex justify-end">
                <SubmitButton tone="accent" size="sm">Add Internal Note</SubmitButton>
              </div>
            </form>

            {messages.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-6 text-center text-xs text-slate-500">
                No ticket messages yet.
              </p>
            ) : (
              <ol className="space-y-2">
                {messages.map((message) => (
                  <li key={message.id} className={`rounded-lg border p-3 ${message.isInternal ? "border-amber-400/20 bg-amber-500/5" : "border-white/10 bg-white/[0.02]"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <StatusPill status={message.isInternal ? "internal" : message.sender} variant={message.isInternal ? "warn" : "neutral"} />
                        <span className="text-xs font-medium text-white">{message.senderName || message.sender}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {message.createdAt ? new Date(message.createdAt).toLocaleString() : "—"}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-slate-200">{message.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Operations Snapshot" subtitle="Live ownership, response, and SLA posture for this ticket.">
            <div className="grid gap-3 sm:grid-cols-2">
              <SnapshotItem
                icon={<UserRound className="h-4 w-4 text-emerald-300" />}
                label="Owner"
                value={ticket.assigneeName || "Unassigned"}
                detail={ticket.department || "Support"}
              />
              <SnapshotItem
                icon={<Clock3 className="h-4 w-4 text-cyan-300" />}
                label="First response"
                value={ticket.firstResponseAt ? new Date(ticket.firstResponseAt).toLocaleString() : "Pending"}
                detail={ticket.lastMessageAt ? `Last activity ${new Date(ticket.lastMessageAt).toLocaleString()}` : "No replies logged"}
              />
              <SnapshotItem
                icon={<ShieldAlert className="h-4 w-4 text-rose-300" />}
                label="SLA"
                value={ticket.slaDeadline ? new Date(ticket.slaDeadline).toLocaleString() : "Not set"}
                detail={ticket.slaBreached ? "Breached" : "Within target"}
              />
              <SnapshotItem
                icon={<MessageSquareText className="h-4 w-4 text-fuchsia-300" />}
                label="Customer"
                value={ticket.customerName || ticket.customerEmail || "Not recorded"}
                detail={ticket.ticketNumber || ticket.id.slice(0, 8)}
              />
            </div>
          </SectionCard>

          <SectionCard title="Fast Actions" subtitle="Move the ticket forward without editing the full form.">
            <div className="grid gap-2">
              {ticket.status !== "in_progress" && ticket.status !== "resolved" && ticket.status !== "closed" && (
                <form action={updateTicketDetail}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="subject" value={ticket.subject || ""} />
                  <input type="hidden" name="department" value={ticket.department || "Support"} />
                  <input type="hidden" name="status" value="in_progress" />
                  <input type="hidden" name="priority" value={ticket.priority || "normal"} />
                  <input type="hidden" name="assignedTo" value={ticket.assigneeId || ""} />
                  <input type="hidden" name="customerName" value={ticket.customerName || ""} />
                  <input type="hidden" name="customerEmail" value={ticket.customerEmail || ""} />
                  <input type="hidden" name="tags" value={tagsValue} />
                  <input type="hidden" name="redirectTo" value={returnTo} />
                  <SubmitButton tone="warn" className="w-full justify-center">Mark In Progress</SubmitButton>
                </form>
              )}
              {ticket.status !== "resolved" && ticket.status !== "closed" && (
                <form action={updateTicketDetail}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="subject" value={ticket.subject || ""} />
                  <input type="hidden" name="department" value={ticket.department || "Support"} />
                  <input type="hidden" name="status" value="resolved" />
                  <input type="hidden" name="priority" value={ticket.priority || "normal"} />
                  <input type="hidden" name="assignedTo" value={ticket.assigneeId || ""} />
                  <input type="hidden" name="customerName" value={ticket.customerName || ""} />
                  <input type="hidden" name="customerEmail" value={ticket.customerEmail || ""} />
                  <input type="hidden" name="tags" value={tagsValue} />
                  <input type="hidden" name="redirectTo" value={returnTo} />
                  <SubmitButton tone="ok" className="w-full justify-center">Resolve Ticket</SubmitButton>
                </form>
              )}
              {ticket.status !== "closed" && (
                <form action={closeTicket}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="redirectTo" value={returnTo} />
                  <SubmitButton tone="bad" className="w-full justify-center">Close Ticket</SubmitButton>
                </form>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </ConsolePageShell>
  );
}

const SnapshotItem = ({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) => (
  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className="mt-2 text-sm font-semibold text-white">{value}</p>
        <p className="mt-1 text-[10px] text-slate-500">{detail}</p>
      </div>
      <span className="rounded-lg border border-white/10 bg-white/5 p-2">{icon}</span>
    </div>
  </div>
);

import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function updateTicket(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const subject = String(formData.get("subject") || "").trim();
  const status = String(formData.get("status") || "open");
  const priority = String(formData.get("priority") || "normal");
  const assignedTo = String(formData.get("assignedTo") || "").trim() || null;
  if (!id || !subject) redirect(`/console/support/${id}/edit?error=Subject+required`);
  try {
    await panelExec(
      `UPDATE chat_tickets SET subject = $2, status = $3, priority = $4, assigned_to = $5, updated_at = NOW() WHERE id = $1`,
      [id, subject, status, priority, assignedTo],
    );
  } catch (err) {
    redirect(`/console/support/${id}/edit?error=${encodeURIComponent(err instanceof Error ? err.message : "update_failed")}`);
  }
  redirect("/console/support");
}

async function deleteTicket(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`UPDATE chat_tickets SET status = 'closed', updated_at = NOW() WHERE id = $1`, [id]);
  } catch {}
  redirect("/console/support");
}

export default async function EditTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { id } = await params;
  const sp = await searchParams;

  const [rows, agents] = await Promise.all([
    panelQuery<{ id: string; subject: string | null; status: string; priority: string | null; assigned_to: string | null }>(
      `SELECT id, subject, status, priority, assigned_to FROM chat_tickets WHERE id = $1`,
      [id],
    ),
    panelQuery<{ id: string; name: string }>(
      `SELECT id, COALESCE(display_name, email) AS name FROM users WHERE role IN ('admin','support','agent') ORDER BY name ASC LIMIT 50`,
    ),
  ]);
  if (rows.length === 0) notFound();
  const t = rows[0]!;

  return (
    <ConsolePageShell session={session} activePath="/console/support" title={`Edit Ticket`}>
      <FormShell
        backHref="/console/support"
        backLabel="Back to Support"
        title={t.subject || "Untitled ticket"}
        error={sp.error || null}
        action={updateTicket}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field label="Subject" name="subject" required defaultValue={t.subject || ""} />
        <Field
          label="Status"
          name="status"
          type="select"
          defaultValue={t.status}
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
          defaultValue={t.priority || "normal"}
          options={[
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "High" },
            { value: "critical", label: "Critical" },
          ]}
        />
        <Field
          label="Assignee"
          name="assignedTo"
          type="select"
          defaultValue={t.assigned_to || ""}
          options={[{ value: "", label: "Unassigned" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
        />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Close ticket</h3>
          <p className="mt-1 text-xs text-rose-200/70">Sets status to closed; conversation history preserved.</p>
          <form action={deleteTicket} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30">Close ticket</button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

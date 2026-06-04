import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

async function createTicket(formData: FormData) {
  "use server";

  const subject = String(formData.get("subject") || "").trim();
  const priority = String(formData.get("priority") || "normal");
  const tenantId = String(formData.get("tenantId") || "").trim() || null;
  const assignedTo = String(formData.get("assignedTo") || "").trim() || null;

  if (!subject) {
    redirect(`/console/support/new?error=${encodeURIComponent("Subject is required")}`);
  }

  const id = randomUUID();
  const ticketNumber = `TKT-${id.slice(0, 8).toUpperCase()}`;
  try {
    await panelExec(
      `INSERT INTO chat_tickets (id, ticket_number, subject, status, priority, tenant_id, assigned_to, created_at, updated_at)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, NOW(), NOW())`,
      [id, ticketNumber, subject, priority, tenantId, assignedTo],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(`/console/support/new?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/console/support`);
}

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;

  const [tenants, agents] = await Promise.all([
    panelQuery<{ id: string; name: string }>(
      `SELECT id, COALESCE(name, company_name, slug, id) AS name FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY name ASC LIMIT 200`,
    ),
    panelQuery<{ id: string; name: string }>(
      `SELECT id, COALESCE(display_name, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), email) AS name
         FROM users
        WHERE role IN ('admin','support','agent')
          AND COALESCE(is_active, TRUE) = TRUE
        ORDER BY name ASC
        LIMIT 50`,
    ),
  ]);

  return (
    <ConsolePageShell session={session} activePath="/console/support" title="New Support Ticket">
      <FormShell
        backHref="/console/support"
        backLabel="Back to Support"
        title="Open a new support ticket"
        description="Tickets feed into the Open Tickets KPI on the overview and into Support & SLA tracking."
        error={sp.error || null}
        action={createTicket}
      >
        <Field label="Subject" name="subject" required placeholder="Brief summary of the issue" />
        <Field
          label="Priority"
          name="priority"
          type="select"
          defaultValue="normal"
          options={[
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "High" },
            { value: "critical", label: "Critical" },
          ]}
        />
        <Field
          label="Client (optional)"
          name="tenantId"
          type="select"
          options={[{ value: "", label: "(unassigned)" }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]}
        />
        <Field
          label="Assign To (optional)"
          name="assignedTo"
          type="select"
          options={[{ value: "", label: "(unassigned)" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
        />
      </FormShell>
    </ConsolePageShell>
  );
}

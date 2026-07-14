import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { loadTenantHeader } from "../../lib/modules/tenants";
import { loadSupportAgentsForForm } from "../../lib/modules/support-actions";
import { tenantPath } from "../../lib/urls";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

const buildNewTicketRedirect = (params: { error: string | undefined; tenantId: string | undefined; returnTo: string | undefined }) => {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error);
  if (params.tenantId) search.set("tenantId", params.tenantId);
  if (params.returnTo) search.set("returnTo", params.returnTo);
  const qs = search.toString();
  return `/console/support/new${qs ? `?${qs}` : ""}`;
};

async function createTicket(formData: FormData) {
  "use server";

  const session = await getSession();
  const subject = String(formData.get("subject") || "").trim();
  const priority = String(formData.get("priority") || "normal");
  const department = String(formData.get("department") || "Support").trim() || "Support";
  const tenantId = String(formData.get("tenantId") || "").trim() || null;
  const assignedTo = String(formData.get("assignedTo") || "").trim() || null;
  const customerName = String(formData.get("customerName") || "").trim() || null;
  const customerEmail = String(formData.get("customerEmail") || "").trim() || null;
  const tags = String(formData.get("tags") || "").trim();
  const initialNote = String(formData.get("initialNote") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || null;

  if (!subject) {
    redirect(buildNewTicketRedirect({ error: "Subject is required", tenantId: tenantId || undefined, returnTo: returnTo || undefined }));
  }

  const id = randomUUID();
  const ticketNumber = `TKT-${id.slice(0, 8).toUpperCase()}`;
  try {
    await panelExec(
      `INSERT INTO chat_tickets
         (id, ticket_number, subject, department, status, priority, tenant_id, customer_name, customer_email, assigned_to, tags, source, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8, $9, $10, 'admin', $11, NOW(), NOW())`,
      [
        id,
        ticketNumber,
        subject,
        department,
        priority,
        tenantId,
        customerName,
        customerEmail,
        assignedTo,
        JSON.stringify(
          tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
        session?.email || null,
      ],
    );
    if (initialNote) {
      await panelExec(
        `INSERT INTO chat_ticket_messages
           (id, ticket_id, sender, sender_name, body, is_internal, ai_generated, created_at)
         VALUES ($1, $2, 'admin', $3, $4, TRUE, FALSE, NOW())`,
        [randomUUID(), id, session?.email || "Console", initialNote],
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(buildNewTicketRedirect({ error: msg, tenantId: tenantId || undefined, returnTo: returnTo || undefined }));
  }

  redirect(returnTo || (tenantId ? tenantPath(tenantId) : "/console/support"));
}

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tenantId?: string; returnTo?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;
  const selectedTenantId = (sp.tenantId || "").trim();
  const returnTo = (sp.returnTo || "").trim() || "/console/support";
  const scopedToClient = returnTo.startsWith("/console/clients/");

  const [tenants, agents] = await Promise.all([
    panelQuery<{ id: string; name: string }>(
      `SELECT id, COALESCE(name, company_name, slug, id) AS name FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY name ASC LIMIT 200`,
    ),
    loadSupportAgentsForForm(),
  ]);
  const selectedTenant = selectedTenantId ? await loadTenantHeader(selectedTenantId) : null;

  return (
    <ConsolePageShell session={session} activePath="/console/support" title="New Support Ticket">
      <FormShell
        backHref={returnTo}
        backLabel={scopedToClient ? "Back to Client" : "Back to Support"}
        title="Open a new support ticket"
        description="Tickets feed into the Open Tickets KPI on the overview and into Support & SLA tracking."
        error={sp.error || null}
        notice={selectedTenant ? `This ticket will be opened for ${selectedTenant.name}.` : null}
        action={createTicket}
      >
        <input type="hidden" name="returnTo" value={returnTo} />
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
          label="Department"
          name="department"
          type="select"
          defaultValue="Support"
          options={[
            { value: "Support", label: "Support" },
            { value: "Billing", label: "Billing" },
            { value: "Hosting", label: "Hosting" },
            { value: "Email", label: "Email" },
            { value: "Security", label: "Security" },
          ]}
        />
        <Field
          label="Client (optional)"
          name="tenantId"
          type="select"
          defaultValue={selectedTenantId || ""}
          options={[{ value: "", label: "(unassigned)" }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]}
        />
        <Field label="Customer Name" name="customerName" placeholder="Primary requester or stakeholder" />
        <Field label="Customer Email" name="customerEmail" type="email" placeholder="name@company.com" />
        <Field
          label="Assign To (optional)"
          name="assignedTo"
          type="select"
          options={[{ value: "", label: "(unassigned)" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
        />
        <Field label="Tags" name="tags" placeholder="urgent, migration, renewal" hint="Comma-separated tags for queue routing." />
        <Field
          label="Internal Note"
          name="initialNote"
          type="textarea"
          placeholder="Add setup context, troubleshooting notes, or triage guidance for the team."
        />
      </FormShell>
    </ConsolePageShell>
  );
}

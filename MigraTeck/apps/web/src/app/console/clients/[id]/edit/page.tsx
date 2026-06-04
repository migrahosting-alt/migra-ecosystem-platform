import { redirect, notFound } from "next/navigation";

import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { logClientEvent } from "../../../lib/modules/audit";
import { tenantPath, editTenantPath } from "../../../lib/urls";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function loadClient(id: string) {
  const rows = await panelQuery<{
    id: string;
    name: string | null;
    company_name: string | null;
    billing_email: string | null;
    tenant_type: string | null;
    domain: string | null;
    status: string | null;
    is_active: boolean | null;
  }>(
    `SELECT id, name, company_name, billing_email, tenant_type, domain, status, is_active
       FROM tenants WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function updateClient(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim() || null;
  const billingEmail = String(formData.get("billingEmail") || "").trim() || null;
  const tenantType = String(formData.get("tenantType") || "CLIENT");
  const status = String(formData.get("status") || "active");
  const isActive = status !== "paused" && status !== "churned";

  if (!id || !name) {
    redirect(`${editTenantPath(id)}?error=${encodeURIComponent("Name is required")}`);
  }

  const actor = (await getSession())?.email || null;

  try {
    await panelExec(
      `UPDATE tenants
          SET name = $2, company_name = $3, billing_email = $4, tenant_type = $5,
              status = $6, is_active = $7, updated_at = NOW()
        WHERE id = $1`,
      [id, name, companyName, billingEmail, tenantType, status, isActive],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "update_failed";
    await logClientEvent({
      tenantId: id, actorEmail: actor, action: "tenant.update",
      resource: "tenant", resourceId: id,
      metadata: { name, companyName, billingEmail, tenantType, status },
      result: "failure", error: msg,
    });
    redirect(`${editTenantPath(id)}?error=${encodeURIComponent(msg)}`);
  }

  await logClientEvent({
    tenantId: id, actorEmail: actor, action: "tenant.update",
    resource: "tenant", resourceId: id,
    metadata: { name, companyName, billingEmail, tenantType, status },
  });

  redirect(tenantPath(id));
}

async function deleteClient(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  const actor = (await getSession())?.email || null;
  try {
    await panelExec(
      `UPDATE tenants SET is_active = FALSE, status = 'churned', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    );
    await logClientEvent({
      tenantId: id, actorEmail: actor, action: "tenant.delete",
      resource: "tenant", resourceId: id,
    });
  } catch (err) {
    await logClientEvent({
      tenantId: id, actorEmail: actor, action: "tenant.delete",
      resource: "tenant", resourceId: id,
      result: "failure", error: err instanceof Error ? err.message : String(err),
    });
  }
  redirect("/console/clients");
}

export default async function EditClientPage({
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
  const client = await loadClient(id);
  if (!client) notFound();

  return (
    <ConsolePageShell session={session} activePath="/console/clients" title={`Edit ${client.name || id}`}>
      <FormShell
        backHref={`/console/clients/${id}`}
        backLabel="Back to Client"
        title="Edit client"
        description="Updates take effect immediately. Soft-delete via the danger zone preserves history."
        error={sp.error || null}
        action={updateClient}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field label="Client Name" name="name" required defaultValue={client.name || ""} />
        <Field label="Legal Company Name" name="companyName" defaultValue={client.company_name || ""} />
        <Field label="Billing Email" name="billingEmail" type="email" defaultValue={client.billing_email || ""} />
        <Field
          label="Tenant Type"
          name="tenantType"
          type="select"
          defaultValue={client.tenant_type || "CLIENT"}
          options={[
            { value: "CLIENT", label: "Client" },
            { value: "PROSPECT", label: "Prospect" },
            { value: "INTERNAL", label: "Internal" },
          ]}
        />
        <Field
          label="Status"
          name="status"
          type="select"
          defaultValue={client.status || "active"}
          options={[
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
            { value: "trial", label: "Trial" },
            { value: "churned", label: "Churned" },
          ]}
        />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Danger zone</h3>
          <p className="mt-1 text-xs text-rose-200/70">
            Soft-delete this client. The record is preserved but marked churned and hidden from lists. Data tied to the client (domains, mailboxes, invoices) is NOT removed.
          </p>
          <form action={deleteClient} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30"
            >
              Delete client
            </button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

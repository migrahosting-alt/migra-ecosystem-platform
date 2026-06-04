import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec } from "../../lib/db";
import { logClientEvent } from "../../lib/modules/audit";
import { tenantPath } from "../../lib/urls";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

async function createClient(formData: FormData) {
  "use server";

  const name = String(formData.get("name") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim() || null;
  const billingEmail = String(formData.get("billingEmail") || "").trim() || null;
  const tenantType = String(formData.get("tenantType") || "CLIENT");
  const domain = String(formData.get("domain") || "").trim() || null;

  if (!name) {
    redirect("/console/clients/new?error=Name+is+required");
  }

  const id = randomUUID();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || id.slice(0, 8);

  const actor = (await getSession())?.email || null;

  try {
    await panelExec(
      `INSERT INTO tenants (id, name, company_name, billing_email, tenant_type, slug, domain, status, is_active, createdat, "createdAt", updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', TRUE, NOW(), NOW(), NOW())`,
      [id, name, companyName, billingEmail, tenantType, slug, domain],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    await logClientEvent({
      tenantId: id, actorEmail: actor, action: "tenant.create",
      resource: "tenant", resourceId: id,
      metadata: { name, companyName, billingEmail, tenantType, domain },
      result: "failure", error: msg,
    });
    redirect(`/console/clients/new?error=${encodeURIComponent(msg)}`);
  }

  await logClientEvent({
    tenantId: id, actorEmail: actor, action: "tenant.create",
    resource: "tenant", resourceId: id,
    metadata: { name, companyName, billingEmail, tenantType, domain },
  });

  redirect(tenantPath(id));
}

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;

  return (
    <ConsolePageShell session={session} activePath="/console/clients" title="New Client">
      <FormShell
        backHref="/console/clients"
        backLabel="Back to Clients"
        title="Create a new client"
        description="Provision a new tenant in the MigraPanel database. The tenant becomes the parent for domains, mailboxes, subscriptions, and services."
        error={sp.error || null}
        action={createClient}
      >
        <Field label="Company / Client Name" name="name" required placeholder="Acme Corporation" />
        <Field label="Legal Company Name" name="companyName" placeholder="Acme Corp LLC" hint="Used on invoices and contracts. Defaults to the client name." />
        <Field label="Billing Email" name="billingEmail" type="email" placeholder="billing@acme.com" />
        <Field
          label="Tenant Type"
          name="tenantType"
          type="select"
          defaultValue="CLIENT"
          options={[
            { value: "CLIENT", label: "Client" },
            { value: "PROSPECT", label: "Prospect" },
            { value: "INTERNAL", label: "Internal / MigraTeck-owned" },
          ]}
        />
        <Field label="Primary Domain (optional)" name="domain" placeholder="acme.com" hint="If known, attach the client's primary domain. You can add more domains later." />
      </FormShell>
    </ConsolePageShell>
  );
}

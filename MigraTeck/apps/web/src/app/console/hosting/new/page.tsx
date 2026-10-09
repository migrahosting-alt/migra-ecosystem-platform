import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { tenantPath } from "../../lib/urls";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

const buildNewHostingRedirect = (params: {
  error: string | undefined;
  tenantId: string | undefined;
  primaryDomain: string | undefined;
  returnTo: string | undefined;
}) => {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error);
  if (params.tenantId) search.set("tenantId", params.tenantId);
  if (params.primaryDomain) search.set("primaryDomain", params.primaryDomain);
  if (params.returnTo) search.set("returnTo", params.returnTo);
  const qs = search.toString();
  return `/console/hosting/new${qs ? `?${qs}` : ""}`;
};

async function createHostingAccount(formData: FormData) {
  "use server";

  const tenantId = String(formData.get("tenantId") || "").trim();
  const primaryDomain = String(formData.get("primaryDomain") || "").trim().toLowerCase();
  const plan = String(formData.get("plan") || "starter");
  const returnTo = String(formData.get("returnTo") || "").trim() || null;

  if (!tenantId || !primaryDomain) {
    redirect(buildNewHostingRedirect({ error: "Client and primary domain are required", tenantId, primaryDomain, returnTo: returnTo || undefined }));
  }

  const id = randomUUID();
  try {
    // 1. Create the website row in pending state
    await panelExec(
      `INSERT INTO websites (id, "tenantId", "primaryDomain", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'pending', NOW(), NOW())`,
      [id, tenantId, primaryDomain],
    );

    // 2. Queue a provisioning_task — backend workers pick this up to actually
    //    allocate a cloud_pod, set up nginx vhost, issue SSL cert, etc.
    await panelExec(
      `INSERT INTO provisioning_tasks (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt")
       VALUES ($1, $2, $3, 'hosting.provision', 'queued', $4, NOW())`,
      [randomUUID(), tenantId, id, randomUUID()],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(buildNewHostingRedirect({ error: msg, tenantId, primaryDomain, returnTo: returnTo || undefined }));
  }

  redirect(returnTo || tenantPath(tenantId) || `/console/hosting`);
}

export default async function NewHostingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tenantId?: string; primaryDomain?: string; returnTo?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;
  const selectedTenantId = (sp.tenantId || "").trim();
  const selectedPrimaryDomain = (sp.primaryDomain || "").trim().toLowerCase();
  const returnTo = (sp.returnTo || "").trim() || "/console/hosting";
  const scopedToClient = returnTo.startsWith("/console/clients/");

  const tenants = await panelQuery<{ id: string; name: string }>(
    `SELECT id, COALESCE(name, company_name, slug, id) AS name FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY name ASC LIMIT 200`,
  );
  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) || null;

  return (
    <ConsolePageShell session={session} activePath="/console/hosting" title="New Hosting Account">
      <FormShell
        backHref={returnTo}
        backLabel={scopedToClient ? "Back to Client" : "Back to Hosting"}
        title="Provision a new hosting account"
        description="Creates a website record and queues a provisioning task. Backend workers allocate the cloud pod, configure nginx, and issue SSL."
        error={sp.error || null}
        notice={
          selectedTenant
            ? `Provisioning will run for ${selectedTenant.name}. Status stays pending until workers finish the deploy.`
            : "Status will show as 'pending' until provisioning workers complete the deploy (typically 2–5 minutes)."
        }
        action={createHostingAccount}
      >
        <input type="hidden" name="returnTo" value={returnTo} />
        <Field
          label="Client"
          name="tenantId"
          type="select"
          required
          defaultValue={selectedTenantId || ""}
          options={tenants.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Field label="Primary Domain" name="primaryDomain" required placeholder="acme.com" defaultValue={selectedPrimaryDomain || ""} />
        <Field
          label="Plan"
          name="plan"
          type="select"
          defaultValue="starter"
          options={[
            { value: "starter", label: "Starter (1 GB RAM, 10 GB storage)" },
            { value: "pro", label: "Pro (2 GB RAM, 40 GB storage)" },
            { value: "business", label: "Business (4 GB RAM, 100 GB storage)" },
            { value: "enterprise", label: "Enterprise (custom)" },
          ]}
        />
      </FormShell>
    </ConsolePageShell>
  );
}

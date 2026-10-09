import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { tenantPath } from "../../lib/urls";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

const buildNewDomainRedirect = (params: { error: string | undefined; tenantId: string | undefined; returnTo: string | undefined }) => {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error);
  if (params.tenantId) search.set("tenantId", params.tenantId);
  if (params.returnTo) search.set("returnTo", params.returnTo);
  const qs = search.toString();
  return `/console/domains/new${qs ? `?${qs}` : ""}`;
};

async function createDomain(formData: FormData) {
  "use server";

  const domain = String(formData.get("domain") || "").trim().toLowerCase();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const role = String(formData.get("role") || "PRIMARY");
  const returnTo = String(formData.get("returnTo") || "").trim() || null;

  if (!domain || !tenantId) {
    redirect(buildNewDomainRedirect({ error: "Domain and client are required", tenantId, returnTo: returnTo || undefined }));
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    redirect(buildNewDomainRedirect({ error: "Invalid domain format", tenantId, returnTo: returnTo || undefined }));
  }

  const id = randomUUID();
  try {
    await panelExec(
      `INSERT INTO domains (id, "tenantId", domain, role, status, "createdAt", "updatedAt", autorenew, registrarmanaged)
       VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW(), FALSE, FALSE)`,
      [id, tenantId, domain, role],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(buildNewDomainRedirect({ error: msg, tenantId, returnTo: returnTo || undefined }));
  }

  redirect(returnTo || tenantPath(tenantId) || `/console/domains`);
}

export default async function NewDomainPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tenantId?: string; returnTo?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;
  const selectedTenantId = (sp.tenantId || "").trim();
  const returnTo = (sp.returnTo || "").trim() || "/console/domains";
  const scopedToClient = returnTo.startsWith("/console/clients/");

  // Load tenants for the select dropdown
  const tenants = await panelQuery<{ id: string; name: string }>(
    `SELECT id, COALESCE(name, company_name, slug, id) AS name
       FROM tenants
      WHERE COALESCE(is_active, TRUE) = TRUE
      ORDER BY name ASC
      LIMIT 200`,
  );
  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) || null;

  return (
    <ConsolePageShell session={session} activePath="/console/domains" title="New Domain">
      <FormShell
        backHref={returnTo}
        backLabel={scopedToClient ? "Back to Client" : "Back to Domains"}
        title="Add a new domain"
        description="Register a domain in MigraPanel and attach it to a client. DNS records, SSL, and email forwarding are configured after the domain is created."
        error={sp.error || null}
        notice={
          selectedTenant
            ? `This domain will be attached to ${selectedTenant.name}. It starts as pending until DNS verification workers promote it.`
            : "The domain is created with status='pending'. DNS-provisioning workers will move it to 'active' once verification succeeds."
        }
        action={createDomain}
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
        <Field label="Domain" name="domain" required placeholder="acme.com" hint="Lowercase, no protocol, no path." />
        <Field
          label="Role"
          name="role"
          type="select"
          defaultValue="PRIMARY"
          options={[
            { value: "PRIMARY", label: "Primary domain" },
            { value: "ALIAS", label: "Alias / redirect" },
            { value: "MAIL_ONLY", label: "Mail-only" },
            { value: "PARKED", label: "Parked" },
          ]}
        />
      </FormShell>
    </ConsolePageShell>
  );
}

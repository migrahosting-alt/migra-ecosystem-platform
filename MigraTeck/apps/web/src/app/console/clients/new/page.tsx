import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec } from "../../lib/db";
import { logClientEvent } from "../../lib/modules/audit";
import { buildPlatformTenantReturn, sanitizePlatformTenantReturn } from "../../lib/platform-handoff";
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
  const source = String(formData.get("source") || "").trim();
  const returnTo = source === "platform"
    ? sanitizePlatformTenantReturn(String(formData.get("returnTo") || ""))
    : null;
  const handoffOrgId = String(formData.get("handoffOrgId") || "").trim() || null;
  const handoffJobId = String(formData.get("handoffJobId") || "").trim() || null;

  if (!name) {
    redirect("/console/clients/new?error=Name+is+required");
  }

  const id = randomUUID();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || id.slice(0, 8);

  const session = await getSession();
  if (!session) redirect("/console/login");
  const actor = session.email || null;

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
    const params = new URLSearchParams({ error: msg, name });
    if (companyName) params.set("companyName", companyName);
    if (billingEmail) params.set("billingEmail", billingEmail);
    if (domain) params.set("domain", domain);
    if (returnTo) {
      params.set("source", "platform");
      params.set("returnTo", returnTo);
      if (handoffOrgId) params.set("handoffOrgId", handoffOrgId);
      if (handoffJobId) params.set("handoffJobId", handoffJobId);
    }
    redirect("/console/clients/new?" + params.toString());
  }

  await logClientEvent({
    tenantId: id, actorEmail: actor, action: "tenant.create",
    resource: "tenant", resourceId: id,
    metadata: { name, companyName, billingEmail, tenantType, domain },
  });

  const platformReturn = buildPlatformTenantReturn({
    returnTo,
    createdTenantId: id,
    handoffOrgId,
    handoffJobId,
  });
  redirect(platformReturn ?? tenantPath(id));
}

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    source?: string;
    name?: string;
    companyName?: string;
    billingEmail?: string;
    domain?: string;
    returnTo?: string;
    handoffOrgId?: string;
    handoffJobId?: string;
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;
  const fromPlatform = sp.source === "platform";
  const safeReturnTo = fromPlatform ? sanitizePlatformTenantReturn(sp.returnTo) : null;

  return (
    <ConsolePageShell session={session} activePath="/console/clients" title="New Client">
      <FormShell
        backHref={safeReturnTo ?? "/console/clients"}
        backLabel={
          safeReturnTo
            ? new URL(safeReturnTo).pathname === "/platform/commerce/catalog"
              ? "Back to Catalog & Entitlements"
              : "Back to Platform Hosting"
            : "Back to Clients"
        }
        title="Create a new client"
        description="Provision a new tenant in the MigraPanel database. The tenant becomes the parent for domains, mailboxes, subscriptions, and services."
        error={sp.error || null}
        notice={
          fromPlatform
            ? safeReturnTo
              ? "Prefilled from MigraTeck Platform. Review the tenant details before creating it. After creation you will return to the originating Platform workspace to verify and explicitly bind the new tenant."
              : "Prefilled from MigraTeck Platform, but the return target was rejected by the safety allowlist. Creation will remain in MigraPanel until you return manually."
            : null
        }
        action={createClient}
      >
        {safeReturnTo ? (
          <>
            <input type="hidden" name="source" value="platform" />
            <input type="hidden" name="returnTo" value={safeReturnTo} />
            {sp.handoffOrgId ? (
              <input type="hidden" name="handoffOrgId" value={sp.handoffOrgId} />
            ) : null}
            {sp.handoffJobId ? (
              <input type="hidden" name="handoffJobId" value={sp.handoffJobId} />
            ) : null}
          </>
        ) : null}
        <Field
          label="Company / Client Name"
          name="name"
          required
          placeholder="Acme Corporation"
          defaultValue={sp.name ?? ""}
        />
        <Field
          label="Legal Company Name"
          name="companyName"
          placeholder="Acme Corp LLC"
          hint="Used on invoices and contracts. Defaults to the client name."
          defaultValue={sp.companyName ?? ""}
        />
        <Field
          label="Billing Email"
          name="billingEmail"
          type="email"
          placeholder="billing@acme.com"
          defaultValue={sp.billingEmail ?? ""}
        />
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
        <Field
          label="Primary Domain (optional)"
          name="domain"
          placeholder="acme.com"
          hint="If known, attach the client's primary domain. You can add more domains later."
          defaultValue={sp.domain ?? ""}
        />
      </FormShell>
    </ConsolePageShell>
  );
}

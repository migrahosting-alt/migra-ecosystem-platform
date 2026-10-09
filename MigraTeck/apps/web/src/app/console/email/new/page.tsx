import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { ensureMailboxMaildir, hashMailboxPassword } from "../../lib/mailbox-provisioning";
import { tenantPath } from "../../lib/urls";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

const buildNewMailboxRedirect = (params: { error: string | undefined; tenantId: string | undefined; returnTo: string | undefined }) => {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error);
  if (params.tenantId) search.set("tenantId", params.tenantId);
  if (params.returnTo) search.set("returnTo", params.returnTo);
  const qs = search.toString();
  return `/console/email/new${qs ? `?${qs}` : ""}`;
};

async function createMailbox(formData: FormData) {
  "use server";

  const localPart = String(formData.get("localPart") || "").trim().toLowerCase();
  const mailDomainId = String(formData.get("mailDomainId") || "").trim();
  const password = String(formData.get("password") || "").trim();
  const selectedTenantId = String(formData.get("tenantId") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || null;

  if (!localPart || !mailDomainId) {
    redirect(buildNewMailboxRedirect({ error: "Local part and domain are required", tenantId: selectedTenantId || undefined, returnTo: returnTo || undefined }));
  }
  if (!/^[a-z0-9._+-]+$/i.test(localPart)) {
    redirect(buildNewMailboxRedirect({ error: "Invalid local part — letters, numbers, dot/underscore/plus/hyphen only", tenantId: selectedTenantId || undefined, returnTo: returnTo || undefined }));
  }

  // Resolve domain name + tenant from mail_domains
  const domains = await panelQuery<{ domain: string; tenantid: string }>(
    `SELECT domain, tenantid FROM mail_domains WHERE id = $1`,
    [mailDomainId],
  );
  if (domains.length === 0) {
    redirect(buildNewMailboxRedirect({ error: "Mail domain not found", tenantId: selectedTenantId || undefined, returnTo: returnTo || undefined }));
  }
  const { domain, tenantid } = domains[0]!;
  const address = `${localPart}@${domain}`;
  const id = randomUUID();
  const normalizedStatus = password ? "active" : "pending";
  let passwordHash: string | null = null;

  try {
    if (password) {
      passwordHash = await hashMailboxPassword(password);
    }

    await panelExec(
      `INSERT INTO mailboxes (id, tenantid, maildomainid, localpart, address, status, createdat, passwordhash)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
      [id, tenantid, mailDomainId, localPart, address, normalizedStatus, passwordHash],
    );

    if (password) {
      await ensureMailboxMaildir(address);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(buildNewMailboxRedirect({ error: msg, tenantId: selectedTenantId || tenantid, returnTo: returnTo || undefined }));
  }

  redirect(returnTo || tenantPath(tenantid) || `/console/email`);
}

export default async function NewMailboxPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tenantId?: string; returnTo?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;
  const selectedTenantId = (sp.tenantId || "").trim();
  const returnTo = (sp.returnTo || "").trim() || "/console/email";
  const scopedToClient = returnTo.startsWith("/console/clients/");

  const domains = await panelQuery<{ id: string; domain: string; tenantname: string | null; tenantid: string | null }>(
    `SELECT md.id, md.domain, t.name AS tenantname, md.tenantid
       FROM mail_domains md
       LEFT JOIN tenants t ON t.id = md.tenantid
      WHERE COALESCE(md.status, 'active') = 'active'
      ORDER BY md.domain ASC
      LIMIT 200`,
  );
  const tenantDomains = selectedTenantId
    ? domains.filter((d) => d.tenantid === selectedTenantId)
    : domains;
  const availableDomains = tenantDomains.length > 0 ? tenantDomains : domains;
  const defaultMailDomainId = availableDomains[0]?.id;
  const tenantName = availableDomains[0]?.tenantname || null;

  return (
    <ConsolePageShell session={session} activePath="/console/email" title="New Mailbox">
      <FormShell
        backHref={returnTo}
        backLabel={scopedToClient ? "Back to Client" : "Back to Email"}
        title="Create a new mailbox"
        description="Creates the mailbox in MigraPanel and provisions its Maildir on mail-core when an initial password is provided."
        error={sp.error || null}
        notice={
          selectedTenantId && tenantDomains.length > 0
            ? `Mailbox will be created under ${tenantName || "the selected client"} mail domains. Provide a password to activate it immediately.`
            : selectedTenantId
              ? "This client has no active mail domain yet. Pick another domain or add a mail domain first."
              : "Provide an initial password to create the mailbox as active immediately. Leave it empty to save the mailbox as pending."
        }
        action={createMailbox}
      >
        <input type="hidden" name="tenantId" value={selectedTenantId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Field
          label="Mail Domain"
          name="mailDomainId"
          type="select"
          required
          defaultValue={defaultMailDomainId || ""}
          options={availableDomains.map((d) => ({
            value: d.id,
            label: `${d.domain}${d.tenantname ? ` — ${d.tenantname}` : ""}`,
          }))}
        />
        <Field label="Local Part" name="localPart" required placeholder="info" hint="Everything before the @. Final address will be local-part@domain." />
        <Field label="Initial Password" name="password" type="password" hint="Optional. If empty, the mailbox starts pending until a password is set." />
      </FormShell>
    </ConsolePageShell>
  );
}

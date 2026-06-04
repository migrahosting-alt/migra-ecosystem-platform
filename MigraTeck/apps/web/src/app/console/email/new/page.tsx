import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

async function createMailbox(formData: FormData) {
  "use server";

  const localPart = String(formData.get("localPart") || "").trim().toLowerCase();
  const mailDomainId = String(formData.get("mailDomainId") || "").trim();
  const _password = String(formData.get("password") || "");

  if (!localPart || !mailDomainId) {
    redirect(`/console/email/new?error=${encodeURIComponent("Local part and domain are required")}`);
  }
  if (!/^[a-z0-9._+-]+$/i.test(localPart)) {
    redirect(`/console/email/new?error=${encodeURIComponent("Invalid local part — letters, numbers, dot/underscore/plus/hyphen only")}`);
  }

  // Resolve domain name + tenant from mail_domains
  const domains = await panelQuery<{ domain: string; tenantid: string }>(
    `SELECT domain, tenantid FROM mail_domains WHERE id = $1`,
    [mailDomainId],
  );
  if (domains.length === 0) {
    redirect(`/console/email/new?error=${encodeURIComponent("Mail domain not found")}`);
  }
  const { domain, tenantid } = domains[0]!;
  const address = `${localPart}@${domain}`;
  const id = randomUUID();

  try {
    // COPILOT: this only writes the DB row. To actually create the maildir on
    // mail-core, hook into the migra-mailcore HTTP service (currently undeployed —
    // see reference_mail_infrastructure memory) OR queue a provisioning_task that
    // a worker on mail-core picks up.
    // Password hash is left null here; admin should set it via the mailbox detail
    // page (not yet built) or via the mailcore API once deployed.
    await panelExec(
      `INSERT INTO mailboxes (id, tenantid, maildomainid, localpart, address, status, createdat, passwordhash)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NULL)`,
      [id, tenantid, mailDomainId, localPart, address],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(`/console/email/new?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/console/email`);
}

export default async function NewMailboxPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;

  const domains = await panelQuery<{ id: string; domain: string; tenantname: string | null }>(
    `SELECT md.id, md.domain, t.name AS tenantname
       FROM mail_domains md
       LEFT JOIN tenants t ON t.id = md.tenantid
      WHERE COALESCE(md.status, 'active') = 'active'
      ORDER BY md.domain ASC
      LIMIT 200`,
  );

  return (
    <ConsolePageShell session={session} activePath="/console/email" title="New Mailbox">
      <FormShell
        backHref="/console/email"
        backLabel="Back to Email"
        title="Create a new mailbox"
        description="Adds a mailbox record to the migrapanel database. Maildir creation on mail-core happens via a separate provisioning step (or the migra-mailcore service once deployed)."
        error={sp.error || null}
        notice="The mailbox is created with status='pending' and no password. Set the password via the mailbox detail page or doveadm on mail-core to activate."
        action={createMailbox}
      >
        <Field
          label="Mail Domain"
          name="mailDomainId"
          type="select"
          required
          options={domains.map((d) => ({
            value: d.id,
            label: `${d.domain}${d.tenantname ? ` — ${d.tenantname}` : ""}`,
          }))}
        />
        <Field label="Local Part" name="localPart" required placeholder="info" hint="Everything before the @. Final address will be local-part@domain." />
        <Field label="Initial Password" name="password" type="text" hint="Optional. If empty, the mailbox starts inactive. Set later via the detail page." />
      </FormShell>
    </ConsolePageShell>
  );
}

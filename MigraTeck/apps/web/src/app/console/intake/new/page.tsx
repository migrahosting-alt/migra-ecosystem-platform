import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

async function createIntakeForm(formData: FormData) {
  "use server";

  const siteId = String(formData.get("siteId") || "").trim();
  const sectionId = String(formData.get("sectionId") || "").trim();
  const provider = String(formData.get("provider") || "").trim();
  const notificationEmail = String(formData.get("notificationEmail") || "").trim() || null;

  if (!siteId || !sectionId || !provider) {
    redirect(`/console/intake/new?error=${encodeURIComponent("Site, section, and provider are required")}`);
  }

  const id = randomUUID();
  try {
    await panelExec(
      `INSERT INTO builder_form_bindings (id, "siteId", "sectionId", provider, "notificationEmail", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4::"BuilderFormBindingProvider", $5, NOW(), NOW())`,
      [id, siteId, sectionId, provider, notificationEmail],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(`/console/intake/new?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/console/intake`);
}

export default async function NewIntakeFormPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;

  const sites = await panelQuery<{ id: string; name: string }>(
    `SELECT id, COALESCE("primaryDomain", id) AS name FROM websites WHERE status != 'deleted' ORDER BY "createdAt" DESC LIMIT 200`,
  );

  return (
    <ConsolePageShell session={session} activePath="/console/intake" title="New Intake Form">
      <FormShell
        backHref="/console/intake"
        backLabel="Back to Intake"
        title="Create a new intake form binding"
        description="Form bindings connect a builder website section to a MigraIntake flow. Submissions route through the selected provider."
        error={sp.error || null}
        action={createIntakeForm}
      >
        <Field
          label="Site"
          name="siteId"
          type="select"
          required
          options={sites.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Field label="Section ID" name="sectionId" required placeholder="contact" hint="Section slug on the builder site (e.g. contact, hero, footer)." />
        <Field
          label="Provider"
          name="provider"
          type="select"
          required
          defaultValue="MI"
          options={[
            { value: "MI", label: "MigraIntake" },
            { value: "EMAIL_ONLY", label: "Email Only" },
          ]}
        />
        <Field label="Notification Email (optional)" name="notificationEmail" placeholder="leads@example.com" hint="Receives an email for each new submission." />
      </FormShell>
    </ConsolePageShell>
  );
}

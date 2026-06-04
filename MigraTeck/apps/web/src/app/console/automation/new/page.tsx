import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

async function createJob(formData: FormData) {
  "use server";

  const name = String(formData.get("name") || "").trim();
  const jobType = String(formData.get("jobType") || "").trim();
  const schedule = String(formData.get("schedule") || "").trim() || null;
  const tenantId = String(formData.get("tenantId") || "").trim();

  if (!name || !jobType || !tenantId) {
    redirect(`/console/automation/new?error=${encodeURIComponent("Name, type, and client are required")}`);
  }

  const id = randomUUID();
  const payload = JSON.stringify({ name, ...(schedule != null ? { schedule } : {}) });
  try {
    await panelExec(
      `INSERT INTO jobs (id, "tenantId", type, status, "targetType", "targetId", "idempotencyKey", "payloadJson", "createdAt")
       VALUES ($1, $2, $3, 'active', 'tenant', $4, $5, $6::jsonb, NOW())`,
      [id, tenantId, jobType, tenantId, randomUUID(), payload],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(`/console/automation/new?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/console/automation`);
}

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;

  const tenants = await panelQuery<{ id: string; name: string }>(
    `SELECT id, COALESCE(name, company_name, slug, id) AS name FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY name ASC LIMIT 200`,
  );

  return (
    <ConsolePageShell session={session} activePath="/console/automation" title="New Automation Job">
      <FormShell
        backHref="/console/automation"
        backLabel="Back to Automation"
        title="Schedule a new automation job"
        description="Jobs run on the schedule provided (cron-format) or on-demand. The job runner picks up active jobs and records each invocation in job_runs."
        error={sp.error || null}
        action={createJob}
      >
        <Field label="Job Name" name="name" required placeholder="Nightly SEO Audit" />
        <Field
          label="Type"
          name="jobType"
          type="select"
          required
          options={[
            { value: "seo.audit", label: "SEO Audit" },
            { value: "backup.run", label: "Backup Run" },
            { value: "report.generate", label: "Generate Report" },
            { value: "marketing.gbp_post", label: "GBP Post" },
            { value: "intake.followup", label: "Lead Follow-up" },
            { value: "custom", label: "Custom" },
          ]}
        />
        <Field label="Schedule (cron)" name="schedule" placeholder="0 2 * * *" hint="Optional. Standard cron expression. Leave blank for on-demand only." />
        <Field
          label="Client"
          name="tenantId"
          type="select"
          required
          options={tenants.map((t) => ({ value: t.id, label: t.name }))}
        />
      </FormShell>
    </ConsolePageShell>
  );
}

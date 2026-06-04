import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function updateJob(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "active");
  if (!id) redirect("/console/automation");
  try {
    await panelExec(`UPDATE jobs SET status = $2 WHERE id = $1`, [id, status]);
  } catch (err) {
    redirect(`/console/automation/${id}/edit?error=${encodeURIComponent(err instanceof Error ? err.message : "update_failed")}`);
  }
  redirect("/console/automation");
}

async function deleteJob(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`UPDATE jobs SET status = 'deleted' WHERE id = $1`, [id]);
  } catch {}
  redirect("/console/automation");
}

export default async function EditJobPage({
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

  const rows = await panelQuery<{ id: string; type: string | null; status: string; payload: string | null }>(
    `SELECT id, type, COALESCE(status, 'active') AS status, "payloadJson"::text AS payload FROM jobs WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) notFound();
  const j = rows[0]!;

  return (
    <ConsolePageShell session={session} activePath="/console/automation" title="Edit Job">
      <FormShell
        backHref="/console/automation"
        backLabel="Back to Automation"
        title={`Job ${j.type || j.id}`}
        description={j.payload ? `Payload: ${j.payload.slice(0, 200)}` : "Job configuration"}
        error={sp.error || null}
        action={updateJob}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field
          label="Status"
          name="status"
          type="select"
          defaultValue={j.status}
          options={[
            { value: "active", label: "Active (scheduled / runnable)" },
            { value: "paused", label: "Paused (no new runs)" },
            { value: "running", label: "Running" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
          ]}
        />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Delete job</h3>
          <p className="mt-1 text-xs text-rose-200/70">Soft-delete. Past job_runs are preserved for audit.</p>
          <form action={deleteJob} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30">Delete job</button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function updateWebsite(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "active");
  if (!id) redirect("/console/hosting");
  try {
    await panelExec(`UPDATE websites SET status = $2, "updatedAt" = NOW() WHERE id = $1`, [id, status]);
  } catch (err) {
    redirect(`/console/hosting/${id}/edit?error=${encodeURIComponent(err instanceof Error ? err.message : "update_failed")}`);
  }
  redirect("/console/hosting");
}

async function deleteWebsite(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`UPDATE websites SET status = 'deleted', "updatedAt" = NOW() WHERE id = $1`, [id]);
  } catch {}
  redirect("/console/hosting");
}

export default async function EditWebsitePage({
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

  const rows = await panelQuery<{ id: string; domain: string | null; status: string }>(
    `SELECT id, "primaryDomain" AS domain, COALESCE(status, 'unknown') AS status FROM websites WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) notFound();
  const w = rows[0]!;

  return (
    <ConsolePageShell session={session} activePath="/console/hosting" title={`Edit ${w.domain || "Site"}`}>
      <FormShell
        backHref="/console/hosting"
        backLabel="Back to Hosting"
        title={w.domain || "Untitled site"}
        description="Primary domain is set during provisioning and immutable here. Status changes affect serving but do not deprovision automatically."
        error={sp.error || null}
        action={updateWebsite}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field
          label="Status"
          name="status"
          type="select"
          defaultValue={w.status}
          options={[
            { value: "pending", label: "Pending provisioning" },
            { value: "active", label: "Active (serving traffic)" },
            { value: "suspended", label: "Suspended (returns 503)" },
            { value: "maintenance", label: "Maintenance mode" },
          ]}
        />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Decommission</h3>
          <p className="mt-1 text-xs text-rose-200/70">Marks the site as deleted. Cloud pod, nginx vhost, and SSL cert are NOT removed automatically — file a deprovisioning task or run manual cleanup on the host.</p>
          <form action={deleteWebsite} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30">Decommission site</button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

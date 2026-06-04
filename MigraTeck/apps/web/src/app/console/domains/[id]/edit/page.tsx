import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function updateDomain(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const role = String(formData.get("role") || "PRIMARY");
  const status = String(formData.get("status") || "active");
  const autorenew = String(formData.get("autorenew") || "false") === "true";
  if (!id) redirect("/console/domains");
  try {
    await panelExec(
      `UPDATE domains SET role = $2, status = $3, autorenew = $4, "updatedAt" = NOW() WHERE id = $1`,
      [id, role, status, autorenew],
    );
  } catch (err) {
    redirect(`/console/domains/${id}/edit?error=${encodeURIComponent(err instanceof Error ? err.message : "update_failed")}`);
  }
  redirect(`/console/domains`);
}

async function deleteDomain(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`UPDATE domains SET status = 'deleted', "updatedAt" = NOW() WHERE id = $1`, [id]);
  } catch {}
  redirect("/console/domains");
}

export default async function EditDomainPage({
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

  const rows = await panelQuery<{ id: string; domain: string; role: string; status: string; autorenew: boolean }>(
    `SELECT id, domain, role, status, COALESCE(autorenew, FALSE) AS autorenew FROM domains WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) notFound();
  const d = rows[0]!;

  return (
    <ConsolePageShell session={session} activePath="/console/domains" title={`Edit ${d.domain}`}>
      <FormShell
        backHref="/console/domains"
        backLabel="Back to Domains"
        title={`Edit ${d.domain}`}
        description="The domain string itself is immutable. Edit role, status, and renewal settings here."
        error={sp.error || null}
        action={updateDomain}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field
          label="Role"
          name="role"
          type="select"
          defaultValue={d.role}
          options={[
            { value: "PRIMARY", label: "Primary" },
            { value: "ALIAS", label: "Alias" },
            { value: "MAIL_ONLY", label: "Mail-only" },
            { value: "PARKED", label: "Parked" },
          ]}
        />
        <Field
          label="Status"
          name="status"
          type="select"
          defaultValue={d.status}
          options={[
            { value: "pending", label: "Pending verification" },
            { value: "active", label: "Active" },
            { value: "verified", label: "Verified" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
        <Field
          label="Auto-renew"
          name="autorenew"
          type="select"
          defaultValue={d.autorenew ? "true" : "false"}
          options={[
            { value: "false", label: "Off — admin must renew manually" },
            { value: "true", label: "On — auto-charge & renew" },
          ]}
        />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Danger zone</h3>
          <p className="mt-1 text-xs text-rose-200/70">Mark domain as deleted. DNS records on dns-core are NOT removed automatically.</p>
          <form action={deleteDomain} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30">Delete domain</button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

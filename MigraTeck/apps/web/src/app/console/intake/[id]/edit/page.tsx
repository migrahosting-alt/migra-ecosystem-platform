import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function updateBinding(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const notificationEmail = String(formData.get("notificationEmail") || "").trim() || null;
  const provider = String(formData.get("provider") || "MI");
  if (!id) redirect("/console/intake");
  try {
    await panelExec(
      `UPDATE builder_form_bindings SET "notificationEmail" = $2, provider = $3::"BuilderFormBindingProvider", "updatedAt" = NOW() WHERE id = $1`,
      [id, notificationEmail, provider],
    );
  } catch (err) {
    redirect(`/console/intake/${id}/edit?error=${encodeURIComponent(err instanceof Error ? err.message : "update_failed")}`);
  }
  redirect("/console/intake");
}

async function deleteBinding(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`DELETE FROM builder_form_bindings WHERE id = $1`, [id]);
  } catch {}
  redirect("/console/intake");
}

export default async function EditBindingPage({
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

  const rows = await panelQuery<{ id: string; siteid: string; sectionid: string; provider: string; notificationemail: string | null }>(
    `SELECT id, "siteId" AS siteid, "sectionId" AS sectionid, provider::text AS provider, "notificationEmail" AS notificationemail
       FROM builder_form_bindings WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) notFound();
  const b = rows[0]!;

  return (
    <ConsolePageShell session={session} activePath="/console/intake" title="Edit Form Binding">
      <FormShell
        backHref="/console/intake"
        backLabel="Back to Intake"
        title={`Binding ${b.siteid} / ${b.sectionid}`}
        description="Site ID and section ID are immutable — they identify which form binding this is. Change provider or notification email."
        error={sp.error || null}
        action={updateBinding}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field
          label="Provider"
          name="provider"
          type="select"
          defaultValue={b.provider}
          options={[
            { value: "MI", label: "MigraIntake" },
            { value: "EMAIL_ONLY", label: "Email only" },
          ]}
        />
        <Field label="Notification Email" name="notificationEmail" defaultValue={b.notificationemail || ""} placeholder="leads@example.com" />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Delete binding</h3>
          <p className="mt-1 text-xs text-rose-200/70">Removes the binding. Existing growth_leads tied to it are preserved.</p>
          <form action={deleteBinding} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30">Delete binding</button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

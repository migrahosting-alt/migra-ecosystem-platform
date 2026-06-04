import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function updateNumber(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "active");
  if (!id) redirect("/console/voice");
  try {
    await panelExec(`UPDATE business_phone_numbers SET status = $2 WHERE id = $1`, [id, status]);
  } catch (err) {
    redirect(`/console/voice/${id}/edit?error=${encodeURIComponent(err instanceof Error ? err.message : "update_failed")}`);
  }
  redirect("/console/voice");
}

async function releaseNumber(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`UPDATE business_phone_numbers SET status = 'released' WHERE id = $1`, [id]);
  } catch {}
  redirect("/console/voice");
}

export default async function EditNumberPage({
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

  const rows = await panelQuery<{ id: string; number: string; status: string }>(
    `SELECT id, number, COALESCE(status, 'active') AS status FROM business_phone_numbers WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) notFound();
  const n = rows[0]!;

  return (
    <ConsolePageShell session={session} activePath="/console/voice" title={`Edit ${n.number}`}>
      <FormShell
        backHref="/console/voice"
        backLabel="Back to Voice"
        title={n.number}
        description="Number is allocated by the upstream provider and immutable. Changing status here flips routing behavior."
        error={sp.error || null}
        action={updateNumber}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field
          label="Status"
          name="status"
          type="select"
          defaultValue={n.status}
          options={[
            { value: "active", label: "Active (routing calls)" },
            { value: "suspended", label: "Suspended (calls return busy)" },
            { value: "ported_out", label: "Ported out" },
          ]}
        />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Release number</h3>
          <p className="mt-1 text-xs text-rose-200/70">Marks as released in the panel. To actually release from the upstream provider (Twilio/Telnyx), file a deprovisioning task.</p>
          <form action={releaseNumber} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30">Release number</button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

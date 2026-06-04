import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function updateMailbox(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "active");
  if (!id) redirect("/console/email");
  try {
    await panelExec(`UPDATE mailboxes SET status = $2 WHERE id = $1`, [id, status]);
  } catch (err) {
    redirect(`/console/email/${id}/edit?error=${encodeURIComponent(err instanceof Error ? err.message : "update_failed")}`);
  }
  redirect("/console/email");
}

async function deleteMailbox(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`UPDATE mailboxes SET status = 'deleted' WHERE id = $1`, [id]);
  } catch {}
  redirect("/console/email");
}

export default async function EditMailboxPage({
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

  const rows = await panelQuery<{ id: string; address: string; status: string }>(
    `SELECT id, address, COALESCE(status, 'active') AS status FROM mailboxes WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) notFound();
  const m = rows[0]!;

  return (
    <ConsolePageShell session={session} activePath="/console/email" title={`Edit ${m.address}`}>
      <FormShell
        backHref="/console/email"
        backLabel="Back to Email"
        title={m.address}
        description="Mailbox address is immutable. Edit status only — password changes happen on mail-core via doveadm."
        error={sp.error || null}
        action={updateMailbox}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field
          label="Status"
          name="status"
          type="select"
          defaultValue={m.status}
          options={[
            { value: "pending", label: "Pending (no password set)" },
            { value: "active", label: "Active" },
            { value: "suspended", label: "Suspended (no auth, mail still delivered)" },
            { value: "disabled", label: "Disabled (auth fails, mail rejected)" },
          ]}
        />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Danger zone</h3>
          <p className="mt-1 text-xs text-rose-200/70">Soft-delete this mailbox. Maildir on mail-core stays for 30 days then is removed by a cleanup worker.</p>
          <form action={deleteMailbox} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30">Delete mailbox</button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

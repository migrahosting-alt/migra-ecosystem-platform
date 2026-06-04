import { redirect, notFound } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";

export const dynamic = "force-dynamic";

async function updatePost(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const summary = String(formData.get("summary") || "").trim() || null;
  const status = String(formData.get("status") || "draft");
  if (!id || !title) redirect(`/console/marketing/${id}/edit?error=Title+required`);
  try {
    await panelExec(`UPDATE gbp_posts SET title = $2, summary = $3, status = $4 WHERE id = $1`, [id, title, summary, status]);
  } catch (err) {
    redirect(`/console/marketing/${id}/edit?error=${encodeURIComponent(err instanceof Error ? err.message : "update_failed")}`);
  }
  redirect("/console/marketing");
}

async function deletePost(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`UPDATE gbp_posts SET status = 'deleted' WHERE id = $1`, [id]);
  } catch {}
  redirect("/console/marketing");
}

export default async function EditPostPage({
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

  const rows = await panelQuery<{ id: string; title: string | null; summary: string | null; status: string }>(
    `SELECT id, title, summary, COALESCE(status, 'draft') AS status FROM gbp_posts WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) notFound();
  const p = rows[0]!;

  return (
    <ConsolePageShell session={session} activePath="/console/marketing" title={`Edit Campaign`}>
      <FormShell
        backHref="/console/marketing"
        backLabel="Back to Marketing"
        title={p.title || "Untitled post"}
        description="Edit campaign content and publishing status."
        error={sp.error || null}
        action={updatePost}
        submitLabel="Save Changes"
      >
        <input type="hidden" name="id" value={id} />
        <Field label="Title" name="title" required defaultValue={p.title || ""} />
        <Field label="Body" name="summary" type="textarea" defaultValue={p.summary || ""} />
        <Field
          label="Status"
          name="status"
          type="select"
          defaultValue={p.status}
          options={[
            { value: "draft", label: "Draft" },
            { value: "scheduled", label: "Scheduled" },
            { value: "published", label: "Published" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </FormShell>

      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-5">
          <h3 className="text-sm font-semibold text-rose-200">Delete post</h3>
          <p className="mt-1 text-xs text-rose-200/70">Marks the post as deleted. Already-published GBP content stays live until the next sync.</p>
          <form action={deletePost} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="rounded-md border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30">Delete post</button>
          </form>
        </div>
      </div>
    </ConsolePageShell>
  );
}

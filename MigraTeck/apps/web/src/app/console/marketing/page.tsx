import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadMarketingData } from "../lib/modules/marketing";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { posts, reviews, audits } = await loadMarketingData();

  const published = posts.filter((p) => ["published", "active"].includes(p.status)).length;
  const avgRating =
    reviews.length > 0
      ? (reviews.reduce((acc, r) => acc + (r.rating ?? 0), 0) / reviews.length).toFixed(1)
      : "—";

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/marketing"
      title="Marketing"
      subtitle={`${posts.length} GBP post(s) · ${reviews.length} review(s) · ${audits.length} SEO audit(s)`}
      actions={
        <Link
          href="/console/marketing/new"
          className="rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-pink-500/30 transition hover:shadow-pink-500/50"
        >
          + New GBP Post
        </Link>
      }
    >
      <StatsRow
        stats={[
          { label: "GBP Posts", value: posts.length },
          { label: "Published", value: published, accent: "ok" },
          { label: "Reviews", value: reviews.length },
          { label: "Avg Rating", value: avgRating, sub: "across all GBP reviews" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="GBP Posts">
          <DataTable
            columns={[
              { key: "title", header: "Title", render: (p) => <span className="text-white">{p.title || "(untitled)"}</span> },
              { key: "client", header: "Client", render: (p) => p.tenantName || "—" },
              { key: "status", header: "Status", render: (p) => <StatusPill status={p.status} /> },
              { key: "when", header: "Posted", render: (p) => p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—" },
              {
                key: "actions",
                header: "",
                align: "right" as const,
                render: (p) => (
                  <Link href={`/console/marketing/${p.id}/edit`} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
                    Edit
                  </Link>
                ),
              },
            ]}
            rows={posts}
            rowKey={(p) => p.id}
            emptyTitle="No GBP posts yet"
            emptyDescription="Create your first GBP post to boost local search visibility."
          />
        </SectionCard>

        <SectionCard title="GBP Reviews">
          <DataTable
            columns={[
              {
                key: "rating",
                header: "★",
                align: "center" as const,
                render: (r) => (
                  <span className={`font-mono font-bold ${(r.rating ?? 0) >= 4 ? "text-amber-400" : (r.rating ?? 0) >= 3 ? "text-slate-300" : "text-rose-400"}`}>
                    {r.rating ?? "—"}
                  </span>
                ),
              },
              { key: "client", header: "Client", render: (r) => r.tenantName || "—" },
              { key: "comment", header: "Comment", render: (r) => <span className="line-clamp-1 text-slate-300">{r.comment || "—"}</span> },
              { key: "when", header: "When", render: (r) => r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—" },
            ]}
            rows={reviews}
            rowKey={(r) => r.id}
            emptyTitle="No reviews yet"
          />
        </SectionCard>
      </div>

      <SectionCard title="SEO Audits">
        <DataTable
          columns={[
            { key: "url", header: "Target URL", render: (a) => <span className="font-mono text-slate-200">{a.targetUrl || a.id}</span> },
            {
              key: "score",
              header: "Score",
              align: "center" as const,
              render: (a) => (
                <span className={`font-mono font-bold ${(a.score ?? 0) >= 80 ? "text-emerald-400" : (a.score ?? 0) >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                  {a.score ?? "—"}
                </span>
              ),
            },
            { key: "status", header: "Status", render: (a) => <StatusPill status={a.status} /> },
            { key: "when", header: "Run At", render: (a) => a.runAt ? new Date(a.runAt).toLocaleString() : "—" },
          ]}
          rows={audits}
          rowKey={(a) => a.id}
          emptyTitle="No SEO audits run yet"
          emptyDescription="Run your first audit to see site performance scores."
        />
      </SectionCard>
    </ConsolePageShell>
  );
}

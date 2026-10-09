import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadHostingData, loadHostingKpis } from "../lib/modules/hosting";
import { loadHostingTargetIndex, targetStatusFor } from "../lib/hosting/target-status";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { FocusBanner } from "../components/FocusBanner";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { TargetStatePill } from "../components/WebsiteTargetPanel";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function HostingPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const [{ websites, deployments, tasks }, kpis, targetIndex] = await Promise.all([
    loadHostingData(),
    loadHostingKpis(),
    loadHostingTargetIndex(),
  ]);

  // Focused arrival from Overview's "Active websites" card. kpis.activeSites is
  // computed with the SAME predicate Overview counts with (status = 'active'),
  // so the number on the card and the number here cannot drift. The website
  // list itself is capped at 50, so if the cap bites, the banner says so rather
  // than quietly showing fewer than the card promised.
  const focusKey = (await searchParams).focus;
  const focusedActive = focusKey === "active";
  const shownWebsites = focusedActive ? websites.filter((w) => w.status === "active") : websites;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/hosting"
      title="Hosting"
      subtitle={`${kpis.totalSites} site(s) · ${kpis.queuedTasks} task(s) in queue · ${kpis.expiringSslCount} SSL expiring soon`}
      actions={
        <Link
          href="/console/hosting/new"
          className="rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-sky-500/30 transition hover:shadow-sky-500/50"
        >
          + New Hosting
        </Link>
      }
    >
      {focusedActive ? (
        <FocusBanner
          shown={shownWebsites.length}
          total={kpis.activeSites}
          noun="active websites"
          because="Websites whose status is active — the same count the Overview card reports, from the same predicate."
          clearHref="/console/hosting"
          {...(shownWebsites.length < kpis.activeSites
            ? { excluded: `${kpis.activeSites - shownWebsites.length} more are active but fall outside the 50 most recent websites loaded here.` }
            : {})}
        />
      ) : null}

      {/* Operator preflight. The backend guard is the authority; this exists so
          nobody is invited into an action that is already known to be refused. */}
      {targetIndex.available && targetIndex.unreconciled > 0 ? (
        <section className="rounded-xl border border-rose-400/25 bg-rose-500/[0.06] p-4">
          <h2 className="text-sm font-semibold text-white">Target reconciliation required</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
            {targetIndex.unreconciled} of {targetIndex.total} websites record a hosting target that does
            not match an authorized customer workload. Server-changing actions on those sites are
            temporarily blocked for safety.{" "}
            <strong className="text-white">The sites themselves are not necessarily offline</strong> —
            this is about where the platform believes their server is. Each row below carries its own
            target state.
          </p>
          <Link
            href="/console/infrastructure"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-rose-400/40 hover:bg-white/10"
          >
            View reconciliation details <span aria-hidden>→</span>
          </Link>
        </section>
      ) : null}

      <StatsRow
        stats={[
          { label: "Total Sites", value: kpis.totalSites },
          { label: "Active", value: kpis.activeSites, accent: "ok" },
          { label: "SSL Expiring (30d)", value: kpis.expiringSslCount, accent: kpis.expiringSslCount > 0 ? "warn" : "ok" },
          { label: "Deploys (7d)", value: kpis.recentDeployments },
          { label: "Queued Tasks", value: kpis.queuedTasks, accent: kpis.queuedTasks > 0 ? "warn" : undefined },
        ]}
      />

      <SectionCard
        title="Websites"
        subtitle="Click a domain to drill into per-site management (SSL, DNS, deploys, backups, operations)."
      >
        <DataTable
          columns={[
            {
              key: "domain",
              header: "Domain",
              render: (w) => (
                <Link href={`/console/hosting/${w.id}`} className="block hover:text-fuchsia-200">
                  <span className="font-medium text-white">{w.domain || "(no domain)"}</span>
                </Link>
              ),
            },
            { key: "client", header: "Client", render: (w) => w.tenantName || "—" },
            { key: "status", header: "Status", render: (w) => <StatusPill status={w.status} /> },
            {
              key: "target",
              header: "Target",
              /* Same status object the detail page renders, from the same
                 control-plane resolver. No second summary logic: if this column
                 and the website page ever disagreed, the operator would have no
                 way to tell which one was lying. */
              render: (w) => (
                <TargetStatePill status={targetStatusFor(targetIndex, { id: w.id, domain: w.domain })} />
              ),
            },
            {
              key: "updated",
              header: "Updated",
              render: (w) =>
                w.updatedAt ? new Date(w.updatedAt).toLocaleDateString() : "—",
            },
            {
              key: "actions",
              header: "",
              align: "right" as const,
              render: (w) => (
                <div className="inline-flex items-center gap-1">
                  <Link
                    href={`/console/hosting/${w.id}`}
                    className="rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-2.5 py-1 text-[10px] font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20"
                  >
                    Manage
                  </Link>
                  <Link
                    href={`/console/hosting/${w.id}/edit`}
                    className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
                  >
                    Edit
                  </Link>
                </div>
              ),
            },
          ]}
          rows={shownWebsites}
          rowKey={(w) => w.id}
          emptyTitle="No websites yet"
          emptyDescription="Add your first hosting account to get started."
        />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Recent Deployments">
          <DataTable
            columns={[
              { key: "site", header: "Site", render: (d) => d.siteName || d.id },
              { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
              {
                key: "when",
                header: "When",
                render: (d) =>
                  d.createdAt ? new Date(d.createdAt).toLocaleString() : "—",
              },
            ]}
            rows={deployments}
            rowKey={(d) => d.id}
            emptyTitle="No deployments yet"
          />
        </SectionCard>

        <SectionCard title="Provisioning Queue">
          <DataTable
            columns={[
              { key: "type", header: "Type", render: (t) => t.type || "task" },
              { key: "status", header: "Status", render: (t) => <StatusPill status={t.status} /> },
              {
                key: "when",
                header: "Queued",
                render: (t) =>
                  t.createdAt ? new Date(t.createdAt).toLocaleString() : "—",
              },
            ]}
            rows={tasks}
            rowKey={(t) => t.id}
            emptyTitle="Queue is empty"
            emptyDescription="All provisioning tasks have completed."
          />
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}

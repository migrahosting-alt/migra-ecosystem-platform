import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Server,
  ShieldCheck,
  GitBranch,
  Database,
  Activity,
  ExternalLink,
  Pause,
  Play,
} from "lucide-react";

import { getSession } from "../../lib/auth";
import { loadWebsiteDetail } from "../../lib/modules/hosting-detail";
import {
  pauseSite,
  resumeSite,
  forceSslRenew,
  triggerDeploy,
  triggerBackup,
} from "../../lib/modules/hosting-server-actions";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { SectionCard } from "../../components/SectionCard";
import { DataTable, StatusPill } from "../../components/DataTable";
import { SubmitButton } from "../../components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function HostingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const { id } = await params;
  const site = await loadWebsiteDetail(id);
  if (!site) notFound();

  const isActive = site.status === "active";

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/hosting"
      title={site.domain || "Untitled site"}
      subtitle={
        [
          site.tenantName ? `Client: ${site.tenantName}` : null,
          site.hostingType ? `Type: ${site.hostingType}` : null,
          site.runtime ? `Runtime: ${site.runtime}` : null,
          site.lastDeployAt ? `Last deploy ${new Date(site.lastDeployAt).toLocaleString()}` : "No deploys yet",
        ]
          .filter(Boolean)
          .join(" · ")
      }
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/console/hosting"
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <Link
            href={`/console/hosting/${id}/edit`}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
          >
            Edit settings
          </Link>
          <StatusPill status={site.status} />
        </div>
      }
    >
      {/* Action toolbar */}
      <SectionCard title="Operations">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {isActive ? (
            <form action={pauseSite}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="tenantId" value={site.tenantId || ""} />
              <SubmitButton tone="warn">
                <Pause className="h-3.5 w-3.5" /> Suspend site
              </SubmitButton>
            </form>
          ) : (
            <form action={resumeSite}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="tenantId" value={site.tenantId || ""} />
              <SubmitButton tone="ok">
                <Play className="h-3.5 w-3.5" /> Resume site
              </SubmitButton>
            </form>
          )}
          <form action={triggerDeploy}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="tenantId" value={site.tenantId || ""} />
            <SubmitButton tone="accent">
              <GitBranch className="h-3.5 w-3.5" /> Deploy latest
            </SubmitButton>
          </form>
          <form action={forceSslRenew}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="tenantId" value={site.tenantId || ""} />
            <SubmitButton>
              <ShieldCheck className="h-3.5 w-3.5" /> Force SSL renew
            </SubmitButton>
          </form>
          <form action={triggerBackup}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="tenantId" value={site.tenantId || ""} />
            <SubmitButton>
              <Database className="h-3.5 w-3.5" /> Run backup now
            </SubmitButton>
          </form>
        </div>
        <p className="mt-3 text-[10px] text-slate-500">
          Action buttons queue tasks in <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px] text-slate-300">provisioning_tasks</code>. Backend workers pick them up — typically completes in 30-120 seconds.
        </p>
      </SectionCard>

      {/* Top metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard icon={Server} label="Status" value={site.status} accent={isActive ? "ok" : "warn"} />
        <MetricCard icon={ShieldCheck} label="SSL active" value={site.ssl.activeCount.toString()} accent={site.ssl.activeCount > 0 ? "ok" : "warn"} />
        <MetricCard icon={GitBranch} label="Deploys (30d)" value={site.deployCount30d.toString()} />
        <MetricCard icon={Activity} label="Open tasks" value={site.provisioningTasks.length.toString()} accent={site.provisioningTasks.length > 0 ? "warn" : "ok"} />
      </div>

      {/* SSL + DNS row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="SSL certificates"
          subtitle={
            site.ssl.expiringSoon.length > 0
              ? `${site.ssl.expiringSoon.length} cert(s) expiring in 30 days`
              : "No certificates expiring soon"
          }
        >
          {site.ssl.expiringSoon.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-slate-500">
              All certificates are valid for at least 30 more days.
            </p>
          ) : (
            <DataTable
              columns={[
                { key: "cn", header: "Domain", render: (c) => <span className="font-mono text-white">{c.domainName || "—"}</span> },
                { key: "provider", header: "Provider", render: (c) => c.provider || "—" },
                {
                  key: "expires",
                  header: "Expires",
                  render: (c) => {
                    if (!c.expiresAt) return "—";
                    const days = Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / 86_400_000);
                    const cls = days <= 7 ? "text-rose-400" : days <= 14 ? "text-amber-400" : "text-slate-300";
                    return <span className={`font-mono text-[11px] ${cls}`}>{new Date(c.expiresAt).toLocaleDateString()} ({days}d)</span>;
                  },
                },
                { key: "auto", header: "Auto-renew", render: (c) => <StatusPill status={c.autoRenew ? "on" : "off"} variant={c.autoRenew ? "ok" : "warn"} /> },
                { key: "status", header: "Status", render: (c) => <StatusPill status={c.status} /> },
              ]}
              rows={site.ssl.expiringSoon}
              rowKey={(c) => c.id}
              emptyTitle="No certs expiring soon"
            />
          )}
        </SectionCard>

        <SectionCard
          title="DNS domains attached"
          subtitle={`${site.domains.length} domain(s) point to this site`}
        >
          <DataTable
            columns={[
              { key: "domain", header: "Domain", render: (d) => <span className="font-medium text-white">{d.domain}</span> },
              { key: "role", header: "Role", render: (d) => d.role },
              { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (d) => (
                  <Link
                    href={`/console/domains/${d.id}/edit`}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10"
                  >
                    Manage <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                ),
              },
            ]}
            rows={site.domains}
            rowKey={(d) => d.id}
            emptyTitle="No domains attached"
          />
        </SectionCard>
      </div>

      {/* Deployments */}
      <SectionCard
        title="Recent deployments"
        subtitle="Last 10 deploys — click Deploy latest above to queue a new one."
      >
        <DataTable
          columns={[
            {
              key: "when",
              header: "When",
              render: (d) => (d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"),
            },
            { key: "name", header: "Name", render: (d) => <span className="text-white">{d.name}</span> },
            { key: "type", header: "Type", render: (d) => <span className="font-mono text-[10px] text-slate-300">{d.type}</span> },
            { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
            {
              key: "duration",
              header: "Took",
              render: (d) => {
                if (!d.createdAt || !d.completedAt) return "—";
                const s = Math.floor((new Date(d.completedAt).getTime() - new Date(d.createdAt).getTime()) / 1000);
                return <span className="font-mono text-[11px]">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>;
              },
            },
          ]}
          rows={site.deployments}
          rowKey={(d) => d.id}
          emptyTitle="No deployments yet"
          emptyDescription="Once you queue a deploy, history will appear here."
        />
      </SectionCard>

      {/* Provisioning tasks (in-flight) */}
      <SectionCard
        title="In-flight provisioning tasks"
        subtitle={
          site.provisioningTasks.length > 0
            ? `${site.provisioningTasks.length} task(s) queued or running`
            : "No tasks pending"
        }
      >
        {site.provisioningTasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-slate-500">
            No provisioning tasks running. Action buttons above queue tasks here.
          </p>
        ) : (
          <DataTable
            columns={[
              { key: "type", header: "Type", render: (t) => <span className="font-mono text-slate-300">{t.type || "—"}</span> },
              { key: "status", header: "Status", render: (t) => <StatusPill status={t.status} /> },
              { key: "queued", header: "Queued at", render: (t) => (t.createdAt ? new Date(t.createdAt).toLocaleString() : "—") },
              {
                key: "wait",
                header: "Waiting",
                render: (t) => {
                  if (!t.createdAt) return "—";
                  const s = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 1000);
                  return <span className="font-mono text-[11px]">{s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`}</span>;
                },
              },
            ]}
            rows={site.provisioningTasks}
            rowKey={(t) => t.id}
            emptyTitle="No tasks"
          />
        )}
      </SectionCard>

      {/* What's coming next */}
      <SectionCard title="Coming soon" subtitle="Modules not yet wired — pending backend service implementation.">
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {[
            { label: "Live resource metrics (disk, bandwidth, CPU)", reason: "needs metrics agent on cloud-core" },
            { label: "PHP / Node runtime version selector", reason: "needs runtime registry table" },
            { label: "Environment variables editor", reason: "needs site_env_vars table" },
            { label: "Cron jobs management", reason: "wires into jobs table — partial" },
            { label: "File manager / SFTP credentials", reason: "needs SFTP provisioning worker" },
            { label: "Database manager (phpMyAdmin link)", reason: "needs db registry table" },
            { label: "Backup snapshots + restore points", reason: "needs backup_runs table populated" },
            { label: "Activity timeline (last 30 events)", reason: "audit_events filter by website_id" },
          ].map((item) => (
            <li key={item.label} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <p className="text-xs font-medium text-slate-200">{item.label}</p>
              <p className="text-[10px] text-slate-500">{item.reason}</p>
            </li>
          ))}
        </ul>
      </SectionCard>
    </ConsolePageShell>
  );
}

const MetricCard = ({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: "ok" | "warn" | "bad";
}) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-xl shadow-slate-950/30 backdrop-blur">
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    </div>
    <p
      className={[
        "mt-1 text-2xl font-bold capitalize",
        accent === "ok" ? "text-emerald-300" : accent === "warn" ? "text-amber-300" : accent === "bad" ? "text-rose-300" : "text-white",
      ].join(" ")}
    >
      {value}
    </p>
  </div>
);


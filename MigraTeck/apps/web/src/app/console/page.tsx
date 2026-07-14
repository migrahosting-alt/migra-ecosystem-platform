import { redirect } from "next/navigation";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { AlertTriangle, Users, Boxes, DollarSign, MessageSquare, Zap, ShieldCheck } from "lucide-react";

import { getSession } from "./lib/auth";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { KpiCard } from "./components/KpiCard";
import { EcosystemGrid } from "./components/EcosystemGrid";
import { SystemMap } from "./components/SystemMap";
import { ActivityFeed } from "./components/ActivityFeed";
import { ServiceHealthPanel } from "./components/ServiceHealthPanel";
import { RevenueChart } from "./components/RevenueChart";
import { ClientsTable } from "./components/ClientsTable";
import { SupportSlaPanel } from "./components/SupportSlaPanel";
import { SecurityCompliancePanel } from "./components/SecurityCompliancePanel";
import { TeamPerformance } from "./components/TeamPerformance";
import { QuickActions } from "./components/QuickActions";

import { loadKpis } from "./lib/kpis";
import { loadEcosystem } from "./lib/ecosystem";
import { loadServiceHealth } from "./lib/health";
import { loadRecentClients } from "./lib/clients";
import { loadRecentActivity } from "./lib/activity";
import { loadSystemMapNodes } from "./lib/system-map";
import { loadRevenueData } from "./lib/revenue";
import { loadSupportSla } from "./lib/support";
import { loadSecurityCompliance } from "./lib/security";
import { loadTeamMembers } from "./lib/team";
import { getPanelDbStatus } from "./lib/db";

const loadOverviewSnapshot = unstable_cache(
  async () => {
    const [
      kpis,
      ecosystem,
      services,
      clients,
      activity,
      mapNodes,
      revenue,
      support,
      security,
      team,
      panelDb,
    ] = await Promise.all([
      loadKpis(),
      loadEcosystem(),
      loadServiceHealth(),
      loadRecentClients(),
      loadRecentActivity(),
      loadSystemMapNodes(),
      loadRevenueData(),
      loadSupportSla(),
      loadSecurityCompliance(),
      loadTeamMembers(),
      getPanelDbStatus(),
    ]);

    return {
      kpis,
      ecosystem,
      services,
      clients,
      activity,
      mapNodes,
      revenue,
      support,
      security,
      team,
      panelDb,
    };
  },
  ["console-overview-snapshot"],
  { revalidate: 20 },
);

export default async function ConsoleHome() {
  const session = await getSession();
  if (!session) {
    redirect("/console/login");
  }

  const {
    kpis,
    ecosystem,
    services,
    clients,
    activity,
    mapNodes,
    revenue,
    support,
    security,
    team,
    panelDb,
  } = await loadOverviewSnapshot();

  // Build sparklines from revenue series. For now, all KPI cards share the same trend.
  const sparkData = revenue.series.map((d) => d.revenue);

  return (
    <div className="flex min-h-screen">
      <Sidebar activePath="/console" />

      <div className="flex flex-1 flex-col">
        <TopBar
          session={{
            displayName: session.email.split("@")[0] || "Admin",
            email: session.email,
            role: "Administrator",
            avatarUrl: null,
          }}
          notifications={Math.min(9, activity.length)}
          messages={Math.min(9, support.totals.openTickets)}
        />

        <main className="flex-1 space-y-4 p-6 lg:p-8">
          {!panelDb.connected ? (
            <div className="flex items-start gap-3 rounded-3xl border border-amber-400/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-300" />
              <div>
                <p className="font-semibold text-amber-50">The Control Center lost its live panel database connection.</p>
                <p className="mt-1 text-amber-100/80">
                  Some cards may look empty until the connection is restored.
                  {panelDb.error ? ` Last error: ${panelDb.error}` : ""}
                </p>
              </div>
            </div>
          ) : null}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard kpi={kpis.totalClients} variant="violet" icon={Users} sparkline={sparkData} />
            <KpiCard kpi={kpis.activeServices} variant="fuchsia" icon={Boxes} sparkline={sparkData} />
            <KpiCard kpi={kpis.monthlyRevenue} variant="amber" icon={DollarSign} sparkline={sparkData} />
            <KpiCard kpi={kpis.openTickets} variant="rose" icon={MessageSquare} sparkline={sparkData} />
            <KpiCard kpi={kpis.automationRuns} variant="blue" icon={Zap} sparkline={sparkData} />
            <KpiCard kpi={kpis.platformHealth} variant="emerald" icon={ShieldCheck} sparkline={sparkData} />
          </div>

          {/* Ecosystem Grid + System Map */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <EcosystemGrid tiles={ecosystem} />
            </div>
            <div>
              <SystemMap nodes={mapNodes} />
            </div>
          </div>

          {/* Activity Feed + Service Health */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ActivityFeed events={activity} />
            <ServiceHealthPanel services={services} />
          </div>

          {/* Revenue + Clients */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueChart data={revenue} />
            </div>
            <div>
              <ClientsTable clients={clients} />
            </div>
          </div>

          {/* Support + Security */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SupportSlaPanel data={support} />
            <SecurityCompliancePanel data={security} />
          </div>

          {/* Team Performance */}
          <TeamPerformance members={team} />

          {/* Quick Actions */}
          <QuickActions />

          <p className="pb-4 pt-2 text-center text-[10px] text-slate-600">
            MigraPanel Control Center · Built {new Date().toLocaleDateString()} ·{" "}
            <Link className="text-slate-500 hover:text-slate-300" href="/console/account" prefetch>
              Control Center settings
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}

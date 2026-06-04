import { redirect } from "next/navigation";
import { Users, Boxes, DollarSign, MessageSquare, Zap, ShieldCheck } from "lucide-react";

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

export default async function ConsoleHome() {
  const session = await getSession();
  if (!session) {
    redirect("/console/login");
  }

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
  ]);

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
          notifications={kpis.totalClients.raw > 0 ? 6 : 0}
          messages={support.totals.openTickets > 0 ? 5 : 0}
        />

        <main className="flex-1 space-y-4 p-6 lg:p-8">
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
            <a className="text-slate-500 hover:text-slate-300" href="/console/about">
              About this dashboard
            </a>
          </p>
        </main>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";

import { getSession } from "./lib/auth";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { EcosystemGrid } from "./components/EcosystemGrid";
import { ActivityFeed } from "./components/ActivityFeed";
import { QuickActions } from "./components/QuickActions";
import { EstateOverview, RequiresAttention, ServiceEvidenceTable } from "./components/UniversePanels";

import { loadUniverse } from "./lib/universe";
import { loadServiceHealth } from "./lib/health";
import { loadEcosystem } from "./lib/ecosystem";
import { loadRecentActivity } from "./lib/activity";
import { loadOpenTicketCount } from "./lib/support-tickets";
import { loadLoginAnomalies } from "./lib/security-observations";
import { ageOnly } from "./lib/fleet/health-contract";

/**
 * MigraTeck Universe — the control-plane overview.
 *
 * REMOVED from this page and why:
 *  - Six KPI cards sharing ONE sparkline built from `revenue.series`. The trend
 *    line under "Total Clients" and "Open Tickets" was plotting revenue. The
 *    original comment said so out loud: "all KPI cards share the same trend".
 *  - `notifications={kpis.totalClients.raw > 0 ? 6 : 0}` — a literal 6 in the
 *    bell badge whenever any client existed. Same for a literal 5 on messages.
 *  - `platformHealth`, derived from `integration_health_checks`, whose newest row
 *    is from 2026-02-23. A verdict computed from 196-day-old data.
 *  - Full revenue chart, clients table, team performance and the expanded support
 *    and security panels. Their modules still exist and own that detail; Universe
 *    reports where attention is required instead of duplicating every subsystem.
 *  - The decorative System Orchestration Map, which could not faithfully
 *    represent the reconciled 24-node estate. It is replaced by an honest pointer
 *    rather than presented as authoritative.
 *
 * Every remaining number traces to a source recorded in lib/universe.ts.
 */
export default async function ConsoleHome() {
  const session = await getSession();
  if (!session) {
    redirect("/console/login");
  }

  // ONE probe pass for the whole page.
  //
  // The service table and the product grid previously observed the estate
  // independently — two probe passes, milliseconds apart, each deciding what
  // health meant. That is how /console could report six services "Healthy" and
  // the same six products "Unknown" in a single render. Probing once and
  // handing the identical array to both panels makes them two renderings of one
  // observation, so they can present it differently but cannot disagree.
  const services = await loadServiceHealth();

  const [universe, ecosystem, activity, support, security] = await Promise.all([
    loadUniverse(services),
    loadEcosystem(services),
    loadRecentActivity(),
    loadOpenTicketCount(),
    loadLoginAnomalies(),
  ]);

  // Both counts now carry their own null + reason, so the page no longer has to
  // infer "was this measured?" from an unrelated stat. The previous version
  // gated on the Clients count being non-null, because support.ts and
  // security.ts returned zero-filled objects that were indistinguishable from a
  // real zero. They no longer do: each returns null with the reason it is null.
  const openTickets = support.count;
  const securityFindings = security.count;

  return (
    <div className="flex min-h-screen">
      <Sidebar activePath="/console" />

      {/* min-w-0 is load-bearing: a flex child defaults to min-width:auto, so
          this column could not shrink below the widest thing inside it (the
          service table's min-w-[34rem]). Below the lg breakpoint — where the
          sidebar is already hidden — that pushed the whole document wider than
          the viewport and the PAGE scrolled sideways instead of the table
          scrolling inside its own overflow-x-auto container. Measured 779px of
          document at a 390px viewport. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Badge counts are real or absent, never synthesised. The messages
            badge reads the same canonical open-ticket count as the Support tile
            below (lib/support-tickets.ts), so the two can never disagree —
            previously the badge and the tile could have been sourced
            independently and drifted. When the count is unmeasurable the badge
            shows nothing rather than a zero that would read as "all clear". */}
        <TopBar
          session={{
            displayName: session.email.split("@")[0] || "Admin",
            email: session.email,
            role: "Administrator",
            avatarUrl: null,
          }}
          notifications={universe.attention.length}
          messages={openTickets}
        />

        <main className="flex-1 space-y-5 p-6 lg:p-8">
          <header>
            <h1 className="text-xl font-semibold tracking-tight text-white">MigraTeck Universe</h1>
            <p className="mt-1 text-xs text-slate-400">
              Live operational view of the MigraTeck estate
            </p>
            <p className="mt-1.5 text-[10px] text-slate-600">
              Rendered {ageOnly(universe.generatedAt)}
              {" · "}
              {universe.estateHealth.state === "unknown"
                ? universe.estateHealth.reason
                : universe.estateHealth.source}
            </p>
          </header>

          <EstateOverview stats={universe.estate} reconciledAt={universe.estateReconciledAt} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <RequiresAttention items={universe.attention} scope={universe.attentionScope} />
            <ServiceEvidenceTable services={universe.services} />
          </div>

          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Products
            </h2>
            <EcosystemGrid tiles={ecosystem} />
          </section>

          {/* Compact operational summaries. Detail lives in each module. */}
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Business operations
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryTile
                label="Billing"
                value={null}
                reason="no verified current alert source"
                href="/console/billing"
              />
              <SummaryTile
                label="Support"
                value={openTickets}
                unit={openTickets === 1 ? "open ticket" : "open tickets"}
                reason={support.reason ?? "not measured"}
                href="/console/support"
              />
              <SummaryTile
                label="Security"
                value={securityFindings}
                unit={securityFindings === 1 ? "login anomaly (7d)" : "login anomalies (7d)"}
                reason={security.reason ?? "not measured"}
                href="/console/security"
              />
              <SummaryTile
                label="Infrastructure"
                value={universe.estate[0]?.value ?? null}
                unit="nodes in estate"
                // The previous reason read "estate not reconciled". It was
                // unreachable — `ESTATE.length` is a literal and never null, so
                // the branch that renders a reason could not fire — and it was
                // also untrue, because the estate WAS reconciled. Dead strings
                // still lie the moment someone makes them reachable.
                reason="estate registry unavailable"
                href="/console/infrastructure"
              />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ActivityFeed events={activity.events} sourceLabel={activity.sourceLabel} />
            <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <h2 className="text-sm font-semibold text-white">Estate map</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Detailed live topology is not yet rendered here. The previous diagram
                could not faithfully represent the reconciled estate, so it is not
                shown rather than shown inaccurately.
              </p>
              {/* Both of this page's Infrastructure affordances pointed at
                  /console/ecosystem — the product grid — because no
                  infrastructure surface existed. They now reach the estate. */}
              <Link
                href="/console/infrastructure"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-fuchsia-400/40 hover:bg-white/10"
              >
                Open Infrastructure <span aria-hidden>→</span>
              </Link>
            </section>
          </div>

          <QuickActions />
        </main>
      </div>
    </div>
  );
}

/** Compact module summary. Renders an honest dash when the value is unmeasured. */
const SummaryTile = ({
  label,
  value,
  unit,
  reason,
  href,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  reason: string;
  href: string;
}) => {
  const measured = value !== null && value !== undefined;
  return (
    <Link
      href={href}
      className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.04]"
    >
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p
        className={[
          "mt-1 font-semibold tabular-nums leading-none",
          measured ? "text-lg text-white" : "text-lg text-slate-600",
        ].join(" ")}
      >
        {measured ? value : "—"}
      </p>
      <p className="mt-1 text-[10px] leading-tight text-slate-500">
        {measured ? unit ?? "" : reason}
      </p>
    </Link>
  );
};

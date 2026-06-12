import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadEcosystem } from "../lib/ecosystem";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { StatsRow } from "../components/StatsRow";
import { ProductLogo } from "../components/ProductLogo";

export const dynamic = "force-dynamic";

const STATUS_DOT: Record<string, string> = {
  operational: "bg-emerald-400",
  degraded: "bg-amber-400",
  down: "bg-rose-400",
  unknown: "bg-slate-500",
};

const STATUS_BADGE: Record<string, string> = {
  operational: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  degraded: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  down: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  unknown: "border-slate-400/20 bg-slate-500/10 text-slate-400",
};

const ROUTE_FOR: Record<string, string> = {
  migrateck: "/console",
  hosting: "/console/hosting",
  panel: "https://control.migrahosting.com/client/login",
  voice: "/console/voice",
  email: "/console/email",
  intake: "/console/intake",
  marketing: "/console/marketing",
  automation: "/console/automation",
  annoupale: "/console/annoupale",
  pale: "/console/pale",
};

export default async function EcosystemPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const tiles = await loadEcosystem();

  const operational = tiles.filter((t) => t.status === "operational").length;
  const degraded = tiles.filter((t) => t.status === "degraded").length;
  const avgActivity =
    tiles.reduce((acc, t) => acc + t.usagePct, 0) / (tiles.length || 1);

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/ecosystem"
      title="Ecosystem"
      subtitle={`${tiles.length} products under unified control`}
    >
      <StatsRow
        stats={[
          { label: "Total Products", value: tiles.length },
          { label: "Operational", value: operational, accent: "ok" },
          {
            label: "Degraded",
            value: degraded,
            accent: degraded > 0 ? "warn" : undefined,
          },
          {
            label: "Avg Activity",
            value: `${avgActivity.toFixed(1)}%`,
            sub: "usage index across all modules",
          },
        ]}
      />

      <SectionCard
        title="All Products"
        subtitle="Click any product to open its management module"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => {
            const href = ROUTE_FOR[t.id] ?? `/console/${t.id}`;
            const isExternal = href.startsWith("http");
            const statusCls =
              STATUS_BADGE[t.status] ?? STATUS_BADGE.unknown!;
            const dotCls = STATUS_DOT[t.status] ?? "bg-slate-500";
            return (
              <Link
                key={t.id}
                href={href}
                target={isExternal ? "_blank" : undefined}
                className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.02] p-5 transition hover:border-white/25 hover:bg-white/[0.04]"
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <ProductLogo src={t.logoSrc} alt={t.logoAlt} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {t.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {t.subtitle}
                    </p>
                  </div>
                </div>

                {/* Activity bar */}
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Activity</span>
                    <span className="font-mono">
                      {t.usagePct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-500 transition-all"
                      style={{ width: `${Math.min(t.usagePct, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Status + CTA */}
                <div className="mt-4 flex items-center justify-between">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize ${statusCls}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${dotCls}`}
                    />
                    {t.status}
                  </span>
                  <span className="text-[11px] font-medium text-fuchsia-300 transition group-hover:text-fuchsia-200">
                    Open →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </SectionCard>
    </ConsolePageShell>
  );
}

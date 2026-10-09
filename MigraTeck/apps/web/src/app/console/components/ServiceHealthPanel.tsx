import Link from "next/link";
import type { ServiceHealth } from "../lib/health";
import { ageLabel, current, type HealthState } from "../lib/fleet/health-contract";
import { aggregateHealth } from "../lib/health";

const STATUS_COLOR: Record<HealthState, string> = {
  operational: "from-emerald-500 to-teal-500",
  degraded: "from-amber-500 to-orange-500",
  down: "from-rose-500 to-red-500",
  unknown: "from-slate-500 to-slate-700",
};

const STATUS_LABEL: Record<HealthState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unverified",
};

export const ServiceHealthPanel = ({ services }: { services: ReadonlyArray<ServiceHealth> }) => {
  const aggregate = aggregateHealth(services);
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Service Health &amp; Uptime</h2>
        <Link
          href="/console/security"
          className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200"
        >
          View All
        </Link>
      </div>

      <ul className="space-y-3">
        {services.map((s) => (
          <li key={s.id}>
            {(() => {
              const h = current(s.health);
              return (
                <>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-slate-200">{s.label}</span>
                    <span className="shrink-0 font-mono text-slate-400">
                      {s.uptime == null ? STATUS_LABEL[h.state] : `${s.uptime.toFixed(2)}%`}
                    </span>
                  </div>
                  {/* The progress bar previously rendered 100% width whenever the
                      state was "ok" — but `uptime` is ALWAYS null in this module,
                      so a full green bar implied a 100% uptime figure that was
                      never measured. Only draw a gauge when a real percentage
                      exists; otherwise show the state's provenance instead. */}
                  {s.uptime == null ? (
                    <p
                      className="truncate text-[10px] text-slate-500"
                      title={h.state === "unknown" ? h.reason : h.source}
                    >
                      {h.state === "unknown" ? h.reason : `${h.source} · ${ageLabel(h)}`}
                    </p>
                  ) : (
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${STATUS_COLOR[h.state]} transition-all`}
                        style={{ width: `${s.uptime}%` }}
                      />
                    </div>
                  )}
                </>
              );
            })()}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-400/15 bg-emerald-500/[0.07] px-3 py-2 text-xs">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
        <span className="font-medium text-emerald-300">{aggregate}</span>
      </div>
    </section>
  );
};

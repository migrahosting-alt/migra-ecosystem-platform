import Link from "next/link";
import type { ServiceHealth } from "../lib/health";
import { aggregateHealth } from "../lib/health";

const STATUS_COLOR: Record<ServiceHealth["status"], string> = {
  ok: "from-emerald-500 to-teal-500",
  degraded: "from-amber-500 to-orange-500",
  down: "from-rose-500 to-red-500",
  unknown: "from-slate-500 to-slate-700",
};

const STATUS_LABEL: Record<ServiceHealth["status"], string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
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
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">{s.label}</span>
              <span className="font-mono text-slate-400">
                {s.uptime == null ? STATUS_LABEL[s.status] : `${s.uptime.toFixed(2)}%`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${STATUS_COLOR[s.status]} transition-all`}
                style={{ width: s.uptime == null ? (s.status === "ok" ? "100%" : "50%") : `${s.uptime}%` }}
              />
            </div>
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

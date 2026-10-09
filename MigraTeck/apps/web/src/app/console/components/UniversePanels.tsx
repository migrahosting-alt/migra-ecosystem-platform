import Link from "next/link";
import { AlertTriangle, CircleAlert, HelpCircle } from "lucide-react";
import type { AttentionItem, AttentionSeverity, EstateStat } from "../lib/universe";
import { ageLabel, ageOnly, current } from "../lib/fleet/health-contract";
// One vocabulary for operational state. This panel used to define its own
// label map saying "Healthy" while EcosystemGrid's said "Operational".
import { HealthBadge } from "./HealthState";
import { INTERNAL_PROBE_SCOPE, type ServiceHealth } from "../lib/health";

/**
 * Universe page panels.
 *
 * Design rules enforced here:
 *  - a value that is not measured renders an em dash with a stated reason,
 *    never 0 and never a plausible-looking placeholder;
 *  - no percentage is rendered without a real denominator;
 *  - no bar or gauge is drawn for a value that is not a proportion;
 *  - every state is accompanied by its provenance (source + age).
 */

/* ── estate overview ───────────────────────────────────────────────────── */

const StatCell = ({ stat }: { stat: EstateStat }) => {
  const measured = stat.value !== null && stat.value !== undefined;
  const body = (
    <>
      <p
        className={[
          "font-semibold tabular-nums leading-none",
          measured ? "text-2xl text-white" : "text-2xl text-slate-600",
        ].join(" ")}
        title={measured ? stat.source : stat.reason ?? "not measured"}
      >
        {measured ? stat.value : "—"}
      </p>
      <p className="mt-1.5 text-[11px] font-medium text-slate-400">{stat.label}</p>
      {!measured && (
        <p className="mt-0.5 text-[10px] leading-tight text-slate-600">
          {stat.reason ?? "not measured"}
        </p>
      )}
    </>
  );

  const cls =
    "rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition";

  return stat.href && measured ? (
    <Link href={stat.href} className={`${cls} hover:border-white/20 hover:bg-white/[0.04]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
};

export const EstateOverview = ({
  stats,
  reconciledAt,
}: {
  stats: ReadonlyArray<EstateStat>;
  /** Capture date of the node registry. Node counts come from a hand-reconciled
   *  literal, which cannot go stale by itself — so its age is stated rather than
   *  left to look as current as the live queries beside it. */
  reconciledAt: string;
}) => (
  <section>
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Estate overview
      </h2>
      <p className="text-[10px] text-slate-600">
        node registry reconciled {reconciledAt} · website and client counts are live
      </p>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => (
        <StatCell key={s.label} stat={s} />
      ))}
    </div>
  </section>
);

/* ── requires attention ────────────────────────────────────────────────── */

const SEVERITY: Record<
  AttentionSeverity,
  { label: string; chip: string; icon: typeof AlertTriangle }
> = {
  critical: { label: "Critical", chip: "border-rose-400/30 bg-rose-500/10 text-rose-200", icon: CircleAlert },
  warning: { label: "Warning", chip: "border-amber-400/30 bg-amber-500/10 text-amber-200", icon: AlertTriangle },
  unknown: { label: "Unknown", chip: "border-slate-400/20 bg-slate-500/10 text-slate-300", icon: HelpCircle },
};

export const RequiresAttention = ({
  items,
  scope,
}: {
  items: ReadonlyArray<AttentionItem>;
  scope: string;
}) => (
  <section className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-white">Requires attention</h2>
        {/* The scope statement is mandatory: an empty list must never be read as
            "the estate is healthy" when coverage is partial. */}
        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{scope}</p>
      </div>
      <span className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[11px] tabular-nums text-slate-300">
        {items.length}
      </span>
    </div>

    {items.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-slate-500">
        Nothing detected within the scope above. This is not an estate-wide all-clear.
      </p>
    ) : (
      <ul className="divide-y divide-white/[0.05]">
        {items.map((item, i) => {
          const s = SEVERITY[item.severity];
          const Icon = s.icon;
          return (
            <li key={`${item.title}-${i}`} className="flex gap-3 px-4 py-3">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                item.severity === "critical" ? "text-rose-300"
                : item.severity === "warning" ? "text-amber-300" : "text-slate-400"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${s.chip}`}>
                    {s.label}
                  </span>
                  <span className="text-xs font-medium text-slate-200">{item.title}</span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-300" title={item.subject}>
                  {item.subject}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{item.detail}</p>
                <p className="mt-1 text-[10px] text-slate-600">
                  {item.observedAt
                    ? `observed ${ageOnly(item.observedAt)} · ${item.source}`
                    : item.source}
                </p>
                {/* Drill-in to the objects responsible. An attention item that
                    names a problem but leaves the operator to go find the
                    subject by hand is a report, not a control surface. */}
                {item.href && (
                  <Link
                    href={item.href}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-slate-200 transition hover:border-fuchsia-400/40 hover:bg-white/10"
                  >
                    {item.reviewLabel ?? "Review affected objects"} <span aria-hidden>→</span>
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

/* ── service evidence table ────────────────────────────────────────────── */

/**
 * Replaces the previous bar-gauge panel. That panel drew a full-width green bar
 * whenever state was "ok" while `uptime` was always null — a gauge implying a
 * 100% uptime figure that was never measured. There is no stored uptime history
 * in this estate, so no percentage is shown at all.
 */
export const ServiceEvidenceTable = ({ services }: { services: ReadonlyArray<ServiceHealth> }) => (
  <section className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
    {/* The heading names the scope on purpose. These probes run from app-core
        over the internal network, so they measure internal reachability — not
        whether a customer can load the site. Calling it "Service health" alone
        invited exactly that misreading. External availability needs a vantage
        point outside the edge and does not exist yet; when it does, it belongs
        in its own panel rather than being merged into this one. */}
    <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
      <h2 className="text-sm font-semibold text-white">Internal service health</h2>
      <span className="text-[10px] text-slate-500">internal probes · no uptime history stored</span>
    </div>
    <p className="border-b border-white/[0.05] px-4 py-2 text-[10px] leading-relaxed text-slate-500">
      {INTERNAL_PROBE_SCOPE}
    </p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-xs">
        <thead>
          <tr className="border-b border-white/[0.05] text-[10px] uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2 font-medium">Service</th>
            <th className="px-3 py-2 font-medium">State</th>
            <th className="px-3 py-2 font-medium">Observation</th>
            <th className="px-3 py-2 text-right font-medium">Latency</th>
            <th className="px-4 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {services.map((s) => {
            const h = current(s.health);
            return (
              <tr key={s.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-2 font-medium text-slate-200">{s.label}</td>
                <td className="px-3 py-2">
                  <HealthBadge health={s.health} />
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {h.state === "unknown" ? h.reason : ageLabel(h)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                  {h.state !== "unknown" && h.latencyMs != null ? `${h.latencyMs} ms` : "—"}
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {h.state === "unknown" ? (h.source ?? "—") : h.source}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </section>
);

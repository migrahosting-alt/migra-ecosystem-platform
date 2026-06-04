import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { Kpi } from "../lib/kpis";

type Variant = "violet" | "fuchsia" | "amber" | "rose" | "blue" | "emerald";

const VARIANTS: Record<Variant, { ring: string; iconBg: string; spark: string }> = {
  violet: { ring: "from-violet-500/40", iconBg: "from-violet-500 to-purple-500", spark: "stroke-violet-400" },
  fuchsia: { ring: "from-fuchsia-500/40", iconBg: "from-fuchsia-500 to-pink-500", spark: "stroke-fuchsia-400" },
  amber: { ring: "from-amber-500/40", iconBg: "from-amber-500 to-orange-500", spark: "stroke-amber-400" },
  rose: { ring: "from-rose-500/40", iconBg: "from-rose-500 to-red-500", spark: "stroke-rose-400" },
  blue: { ring: "from-blue-500/40", iconBg: "from-blue-500 to-cyan-500", spark: "stroke-blue-400" },
  emerald: { ring: "from-emerald-500/40", iconBg: "from-emerald-500 to-teal-500", spark: "stroke-emerald-400" },
};

export type KpiCardProps = {
  kpi: Kpi;
  variant: Variant;
  icon: React.ComponentType<{ className?: string }>;
  sparkline?: ReadonlyArray<number>;
};

const generateSparkPath = (
  values: ReadonlyArray<number>,
  width = 240,
  height = 48,
) => {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 8) - 4;
    return [x, y] as const;
  });
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const fill =
    `M0,${height} ${line.replace("M", "L")} L${width},${height} Z`;
  return { line, fill };
};

export const KpiCard = ({ kpi, variant, icon: Icon, sparkline = [] }: KpiCardProps) => {
  const v = VARIANTS[variant];
  const spark = generateSparkPath(sparkline);
  const deltaLabel =
    kpi.delta.pct == null
      ? "—"
      : `${kpi.delta.pct.toFixed(1)}% vs last month`;
  const DeltaIcon =
    kpi.delta.direction === "up"
      ? TrendingUp
      : kpi.delta.direction === "down"
        ? TrendingDown
        : Minus;
  const deltaColor =
    kpi.delta.direction === "up"
      ? "text-emerald-400"
      : kpi.delta.direction === "down"
        ? "text-rose-400"
        : "text-slate-400";

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur-md transition hover:border-white/20">
      <div
        className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${v.ring} via-transparent to-transparent blur-2xl`}
      />
      <div className="relative flex items-start justify-between">
        <span
          className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${v.iconBg} shadow-lg shadow-slate-950/30`}
        >
          <Icon className="h-5 w-5 text-white" />
        </span>
      </div>

      <div className="relative mt-3">
        <p className="text-xs font-medium text-slate-400">{kpi.label}</p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-white">
          {kpi.value}
        </p>
        {kpi.hint && (
          <p className="mt-1 text-xs font-medium text-emerald-300">{kpi.hint}</p>
        )}
      </div>

      <div className="relative mt-3 flex items-center gap-1.5 text-[11px]">
        <DeltaIcon className={`h-3 w-3 ${deltaColor}`} />
        <span className={`font-semibold ${deltaColor}`}>{deltaLabel}</span>
      </div>

      {spark && (
        <svg
          viewBox="0 0 240 48"
          className="relative mt-3 h-12 w-full"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={`spark-fill-${variant}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={spark.fill} className={`fill-current ${v.spark} opacity-20`} />
          <path
            d={spark.line}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={v.spark}
          />
        </svg>
      )}
    </div>
  );
};

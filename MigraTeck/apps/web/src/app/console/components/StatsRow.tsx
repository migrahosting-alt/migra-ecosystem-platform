import type { ReactNode } from "react";

export type StatItem = {
  label: string;
  value: string | number;
  sub?: string | undefined;
  accent?: "ok" | "warn" | "bad" | undefined;
  icon?: ReactNode;
};

const ACCENT_CLS: Record<string, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-400",
};

export const StatsRow = ({
  stats,
  cols,
}: {
  stats: ReadonlyArray<StatItem>;
  /** Override grid columns. Defaults to 2 on mobile, 4 on sm+. */
  cols?: 2 | 3 | 4 | 5 | 6;
}) => {
  const gridCls =
    cols === 2
      ? "grid-cols-2"
      : cols === 3
        ? "grid-cols-3"
        : cols === 5
          ? "grid-cols-2 sm:grid-cols-5"
          : cols === 6
            ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
            : "grid-cols-2 sm:grid-cols-4"; // default 4

  return (
    <div className={`grid gap-3 ${gridCls}`}>
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 backdrop-blur"
        >
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            {s.label}
          </p>
          <p
            className={`mt-1 text-2xl font-bold tracking-tight ${
              s.accent ? (ACCENT_CLS[s.accent] ?? "text-white") : "text-white"
            }`}
          >
            {typeof s.value === "number" ? s.value.toLocaleString() : s.value}
          </p>
          {s.sub && (
            <p className="mt-0.5 text-[10px] text-slate-500">{s.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
};

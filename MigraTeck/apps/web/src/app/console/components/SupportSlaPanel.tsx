export type SupportSlaData = {
  totals: {
    totalTickets: number;
    openTickets: number;
    avgResponseMinutes: number | null;
    slaCompliancePct: number | null;
  };
  delta: {
    totalPct: number;
    openPct: number;
    responsePct: number;
    compliancePct: number;
  };
  byPriority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  agents: ReadonlyArray<{
    id: string;
    name: string;
    avatarUrl?: string | null;
    workloadPct: number;
  }>;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export const SupportSlaPanel = ({ data }: { data: SupportSlaData }) => {
  const totalByPri =
    data.byPriority.critical + data.byPriority.high + data.byPriority.medium + data.byPriority.low;
  const pct = (n: number) => (totalByPri === 0 ? 0 : Math.round((n / totalByPri) * 100));

  // Build donut chart slices
  const slices = (() => {
    if (totalByPri === 0) return [];
    let offset = 0;
    const arr = [
      { color: "stroke-rose-400", value: data.byPriority.critical, label: "Critical" },
      { color: "stroke-amber-400", value: data.byPriority.high, label: "High" },
      { color: "stroke-blue-400", value: data.byPriority.medium, label: "Medium" },
      { color: "stroke-slate-500", value: data.byPriority.low, label: "Low" },
    ];
    const C = 2 * Math.PI * 40;
    return arr.map((s) => {
      const len = (s.value / totalByPri) * C;
      const slice = { ...s, dasharray: `${len.toFixed(1)} ${(C - len).toFixed(1)}`, offset };
      offset -= len;
      return slice;
    });
  })();

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Support &amp; SLA Overview</h2>
        <select className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300">
          <option>This Week</option>
          <option>Last Week</option>
          <option>This Month</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total Tickets" value={fmt(data.totals.totalTickets)} delta={data.delta.totalPct} good />
        <Stat label="Open" value={fmt(data.totals.openTickets)} delta={data.delta.openPct} good={false} />
        <Stat
          label="Avg. Response Time"
          value={data.totals.avgResponseMinutes == null ? "—" : `${data.totals.avgResponseMinutes}m`}
          delta={data.delta.responsePct}
          good={false}
        />
        <Stat
          label="SLA Compliance"
          value={data.totals.slaCompliancePct == null ? "—" : `${data.totals.slaCompliancePct.toFixed(1)}%`}
          delta={data.delta.compliancePct}
          good
        />
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-medium text-slate-300">Tickets by Priority</p>
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14" />
              {slices.map((s, i) => (
                <circle
                  key={i}
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  strokeWidth="14"
                  strokeDasharray={s.dasharray}
                  strokeDashoffset={s.offset}
                  className={s.color}
                />
              ))}
              <text
                x="50"
                y="48"
                textAnchor="middle"
                className="rotate-90 fill-white"
                fontSize="14"
                fontWeight="700"
                transform="rotate(90 50 50)"
              >
                {fmt(totalByPri)}
              </text>
              <text
                x="50"
                y="60"
                textAnchor="middle"
                className="rotate-90 fill-slate-400"
                fontSize="7"
                transform="rotate(90 50 50)"
              >
                Total
              </text>
            </svg>
            <ul className="flex-1 space-y-1.5 text-[11px]">
              <Legend dot="bg-rose-400" label="Critical" value={data.byPriority.critical} pct={pct(data.byPriority.critical)} />
              <Legend dot="bg-amber-400" label="High" value={data.byPriority.high} pct={pct(data.byPriority.high)} />
              <Legend dot="bg-blue-400" label="Medium" value={data.byPriority.medium} pct={pct(data.byPriority.medium)} />
              <Legend dot="bg-slate-500" label="Low" value={data.byPriority.low} pct={pct(data.byPriority.low)} />
            </ul>
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-medium text-slate-300">Agent Workload</p>
          {data.agents.length === 0 ? (
            <p className="text-xs text-slate-500">No agents assigned yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {data.agents.map((a) => (
                <li key={a.id}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400 text-[8px] font-bold text-white">
                        {a.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                      <span className="text-slate-200">{a.name}</span>
                    </span>
                    <span className="font-mono text-slate-400">{a.workloadPct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-500"
                      style={{ width: `${a.workloadPct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};

const Stat = ({
  label,
  value,
  delta,
  good,
}: {
  label: string;
  value: string;
  delta: number;
  good: boolean;
}) => {
  const isUp = delta >= 0;
  const color = (isUp && good) || (!isUp && !good) ? "text-emerald-400" : "text-rose-400";
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-base font-bold text-white">{value}</p>
      <p className={`text-[10px] ${color}`}>
        {isUp ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
      </p>
    </div>
  );
};

const Legend = ({
  dot,
  label,
  value,
  pct,
}: {
  dot: string;
  label: string;
  value: number;
  pct: number;
}) => (
  <li className="flex items-center justify-between">
    <span className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="text-slate-300">{label}</span>
    </span>
    <span className="font-mono text-slate-400">
      {value} ({pct}%)
    </span>
  </li>
);

export type RevenueDay = {
  date: string; // YYYY-MM-DD
  revenue: number;
  mrr: number;
};

export type RevenueData = {
  series: ReadonlyArray<RevenueDay>;
  totals: {
    revenue: number;
    mrr: number;
    overdueInvoices: number;
    successfulPayments: number;
    collectionRate: number; // 0..100
  };
  delta: {
    revenuePct: number;
    mrrPct: number;
    overduePct: number;
    paymentsPct: number;
    collectionPct: number;
  };
};

const fmtUsd0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtN = (n: number) => n.toLocaleString("en-US");

const buildPath = (values: ReadonlyArray<number>, width: number, height: number) => {
  if (values.length < 2) return { line: "", fill: "" };
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => [
    i * stepX,
    height - ((v - min) / range) * (height - 20) - 10,
  ] as const);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const fill = `${line} L${width},${height} L0,${height} Z`;
  return { line, fill };
};

export const RevenueChart = ({ data }: { data: RevenueData }) => {
  const w = 800;
  const h = 220;
  const rev = buildPath(data.series.map((d) => d.revenue), w, h);
  const mrr = buildPath(data.series.map((d) => d.mrr), w, h);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Revenue, Billing &amp; Collections</h2>
        <select className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300">
          <option>This Month</option>
          <option>Last Month</option>
          <option>This Quarter</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Revenue" value={fmtUsd0(data.totals.revenue)} delta={data.delta.revenuePct} up />
        <Stat label="MRR" value={fmtUsd0(data.totals.mrr)} delta={data.delta.mrrPct} up />
        <Stat label="Overdue Invoices" value={fmtUsd0(data.totals.overdueInvoices)} delta={data.delta.overduePct} up={false} />
        <Stat label="Successful Payments" value={fmtN(data.totals.successfulPayments)} delta={data.delta.paymentsPct} up />
        <Stat label="Collection Rate" value={`${data.totals.collectionRate.toFixed(1)}%`} delta={data.delta.collectionPct} up />
      </div>

      <div className="relative mt-5 aspect-[16/5] w-full">
        <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="rev-fill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="mrr-fill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ec4899" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={rev.fill} fill="url(#rev-fill)" />
          <path d={rev.line} fill="none" stroke="#a855f7" strokeWidth="2" />
          <path d={mrr.fill} fill="url(#mrr-fill)" />
          <path d={mrr.line} fill="none" stroke="#ec4899" strokeWidth="2" strokeDasharray="4 4" />
        </svg>
      </div>

      <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-fuchsia-500" /> Revenue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-pink-500" /> MRR
        </span>
      </div>
    </section>
  );
};

const Stat = ({
  label,
  value,
  delta,
  up,
}: {
  label: string;
  value: string;
  delta: number;
  up: boolean;
}) => {
  const colorClass = (up && delta >= 0) || (!up && delta <= 0) ? "text-emerald-400" : "text-rose-400";
  const arrow = (up && delta >= 0) || (!up && delta <= 0) ? "▲" : "▼";
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-base font-bold text-white">{value}</p>
      <p className={`text-[10px] ${colorClass}`}>
        {arrow} {Math.abs(delta).toFixed(1)}%
      </p>
    </div>
  );
};

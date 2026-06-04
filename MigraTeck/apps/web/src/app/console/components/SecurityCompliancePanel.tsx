export type SecurityComplianceData = {
  loginAnomalies: { count: number; period: string };
  backups: { successPct: number; period: string };
  sslCoverage: { coveredPct: number; status: string };
  firewall: { active: boolean; period: string };
  riskScore: number; // 0-100, lower is better
};

export const SecurityCompliancePanel = ({ data }: { data: SecurityComplianceData }) => {
  const riskBand =
    data.riskScore < 30 ? "Low Risk" : data.riskScore < 60 ? "Medium Risk" : "High Risk";
  const riskColor =
    data.riskScore < 30
      ? "text-emerald-400"
      : data.riskScore < 60
        ? "text-amber-400"
        : "text-rose-400";
  const riskBg =
    data.riskScore < 30
      ? "from-emerald-500 to-teal-500"
      : data.riskScore < 60
        ? "from-amber-500 to-orange-500"
        : "from-rose-500 to-red-500";

  // Risk gauge: half circle (semicircle)
  const C = Math.PI * 50; // half circumference at r=50
  const filled = (data.riskScore / 100) * C;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Security &amp; Compliance</h2>
        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
          Risk Score
        </span>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Metric
          label="Login Anomalies"
          value={data.loginAnomalies.count.toString()}
          sub={data.loginAnomalies.period}
        />
        <Metric
          label="Backups"
          value={`${data.backups.successPct}%`}
          sub={data.backups.period}
          color="emerald"
        />
        <Metric
          label="SSL Coverage"
          value={`${data.sslCoverage.coveredPct.toFixed(1)}%`}
          sub={data.sslCoverage.status}
          color="emerald"
        />
        <Metric
          label="Firewall Status"
          value={data.firewall.active ? "Active" : "Inactive"}
          sub={data.firewall.period}
          color={data.firewall.active ? "emerald" : "rose"}
        />
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
          <svg viewBox="0 0 120 70" className="h-12 w-full">
            <path
              d="M 10,60 A 50,50 0 0 1 110,60"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="M 10,60 A 50,50 0 0 1 110,60"
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${filled.toFixed(1)} ${(C - filled).toFixed(1)}`}
              className={`stroke-current bg-gradient-to-r ${riskBg}`}
              style={{
                stroke:
                  data.riskScore < 30
                    ? "#10b981"
                    : data.riskScore < 60
                      ? "#f59e0b"
                      : "#f43f5e",
              }}
            />
          </svg>
          <p className="text-2xl font-bold text-white">{data.riskScore}</p>
          <p className={`text-[10px] font-medium ${riskColor}`}>{riskBand}</p>
        </div>
      </div>
    </section>
  );
};

const Metric = ({
  label,
  value,
  sub,
  color = "slate",
}: {
  label: string;
  value: string;
  sub: string;
  color?: "slate" | "emerald" | "rose";
}) => {
  const colorClass =
    color === "emerald" ? "text-emerald-300" : color === "rose" ? "text-rose-300" : "text-white";
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colorClass}`}>{value}</p>
      <p className="text-[10px] text-slate-400">{sub}</p>
    </div>
  );
};

type PlatformStatCardProps = {
  label: string;
  value: string;
  detail: string;
};

export function PlatformStatCard({ label, value, detail }: PlatformStatCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1.5 text-[13px] leading-5 text-slate-600">{detail}</p>
    </div>
  );
}

export function MigraHostingStatCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.20)] backdrop-blur-xl">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/40">
        {label}
      </p>
      <p className="mt-3 text-[30px] font-semibold tracking-[-0.03em] text-white">
        {value}
      </p>
      {meta ? (
        <p className="mt-2 text-sm leading-6 text-white/55">{meta}</p>
      ) : null}
    </div>
  );
}

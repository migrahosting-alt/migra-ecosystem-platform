import type { ReactNode } from "react";

type PlatformPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PlatformPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PlatformPageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1.5 font-[var(--font-display)] text-[28px] font-semibold tracking-tight text-slate-950">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-slate-700">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

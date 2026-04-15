import type { ReactNode } from "react";

export function MigraHostingPanel({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.04] shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl">
      {(title || description || actions) ? (
        <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            {title ? (
              <h3 className="text-base font-semibold tracking-[-0.02em] text-white">
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="mt-1 text-sm leading-6 text-white/55">{description}</p>
            ) : null}
          </div>

          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

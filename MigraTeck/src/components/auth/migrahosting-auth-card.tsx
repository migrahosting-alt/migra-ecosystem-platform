import Image from "next/image";
import type { ReactNode } from "react";

export function MigraHostingAuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-3 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-8 sm:p-9">
        <div className="mb-8 text-center">
          <div className="mb-5 flex justify-center">
            <div className="flex items-center gap-3">
              <div className="relative h-11 w-11 overflow-hidden rounded-2xl ring-1 ring-white/10">
                <Image
                  src="/MH.png"
                  alt="MigraHosting"
                  fill
                  className="object-cover"
                  priority
                />
              </div>

              <div className="text-left leading-none">
                <div className="text-[17px] font-semibold tracking-[-0.02em] text-white">
                  MigraHosting
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                  Hosting Access
                </div>
              </div>
            </div>
          </div>

          <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-white">
            {title}
          </h1>

          <p className="mx-auto mt-2 max-w-[300px] text-sm leading-6 text-white/60">
            {subtitle}
          </p>
        </div>

        <div className="space-y-4">{children}</div>

        {footer ? <div className="mt-6">{footer}</div> : null}
      </div>
    </div>
  );
}

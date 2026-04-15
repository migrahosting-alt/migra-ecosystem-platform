import type { ReactNode } from "react";

export function MigraHostingAuthShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.28),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(236,72,153,0.22),transparent_30%),linear-gradient(180deg,#020617_0%,#0b1120_45%,#020617_100%)]" />
        <div className="absolute inset-0 -z-10 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="absolute inset-x-0 top-0 -z-10 h-px bg-white/10" />

        <div className="w-full max-w-[420px]">{children}</div>
      </div>
    </div>
  );
}

import { ReactNode } from "react";

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/92 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)] shadow-[0_6px_16px_rgba(10,22,40,0.05)]">
      {children}
    </span>
  );
}

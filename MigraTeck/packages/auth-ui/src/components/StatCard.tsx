import type { ReactNode } from "react";
import { Card } from "./Card";

export function StatCard({
  label,
  value,
  meta,
  children,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">{label}</p>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">{value}</div>
      {meta ? <div className="mt-2 text-sm text-zinc-400">{meta}</div> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </Card>
  );
}

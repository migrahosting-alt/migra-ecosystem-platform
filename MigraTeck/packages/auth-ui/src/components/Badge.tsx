import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const toneClasses = {
  neutral: "border-white/10 bg-white/5 text-zinc-300",
  primary: "border-fuchsia-400/20 bg-fuchsia-500/15 text-fuchsia-200",
  success: "border-emerald-400/20 bg-emerald-500/15 text-emerald-200",
  warning: "border-amber-400/20 bg-amber-500/15 text-amber-200",
  danger: "border-rose-400/20 bg-rose-500/15 text-rose-200",
  info: "border-sky-400/20 bg-sky-500/15 text-sky-200",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: keyof typeof toneClasses;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const upper = status.toUpperCase();
  const tone =
    upper === "ACTIVE" || upper === "VERIFIED" || upper === "ENABLED"
      ? "success"
      : upper === "PENDING" || upper === "LOCKED"
        ? "warning"
        : upper === "DISABLED" || upper === "REVOKED" || upper === "FAILED"
          ? "danger"
          : upper === "CURRENT"
            ? "info"
            : "neutral";

  return <Badge tone={tone} className={className}>{status}</Badge>;
}

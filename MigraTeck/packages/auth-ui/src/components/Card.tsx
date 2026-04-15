import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-white/10 bg-[rgb(var(--card)/0.82)] text-[rgb(var(--card-foreground))] shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}

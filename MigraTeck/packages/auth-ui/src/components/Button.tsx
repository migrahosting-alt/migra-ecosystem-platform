import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const variantClasses = {
  primary: "bg-[linear-gradient(135deg,var(--brand-start),var(--brand-end))] text-white hover:opacity-95",
  secondary: "bg-white/8 text-zinc-100 hover:bg-white/12",
  outline: "border border-white/10 bg-transparent text-zinc-200 hover:bg-white/6",
  ghost: "bg-transparent text-zinc-300 hover:bg-white/6 hover:text-zinc-100",
  danger: "bg-rose-500/90 text-white hover:bg-rose-500",
  success: "bg-emerald-500/90 text-white hover:bg-emerald-500",
} as const;

const sizeClasses = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base",
  icon: "h-10 w-10",
} as const;

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-2xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring)/0.45)] disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}

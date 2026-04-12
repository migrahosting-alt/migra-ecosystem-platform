import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-slate-950/90 bg-[linear-gradient(180deg,#0f172a_0%,#111827_100%)] text-white shadow-[0_12px_30px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.14)] hover:-translate-y-0.5 hover:border-slate-800 hover:shadow-[0_18px_36px_rgba(15,23,42,0.2),inset_0_1px_0_rgba(255,255,255,0.18)]",
  secondary:
    "border border-slate-200 bg-white/86 text-slate-950 shadow-[0_10px_24px_rgba(148,163,184,0.12),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-sm hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-[0_16px_30px_rgba(148,163,184,0.16),inset_0_1px_0_rgba(255,255,255,0.96)]",
  ghost:
    "border border-transparent bg-white/45 text-slate-950 backdrop-blur-sm hover:bg-white/75",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-4 py-2.5 text-sm",
  md: "px-5 py-3 text-sm",
  lg: "px-6 py-3.5 text-base",
};

export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cx(
    "inline-flex items-center justify-center rounded-full font-semibold transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );
}

export function Button({
  children,
  className,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClassName(variant, size, className)}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

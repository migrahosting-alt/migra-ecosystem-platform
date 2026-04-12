import Link from "next/link";
import { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface BaseProps {
  children: ReactNode;
  className?: string | undefined;
  variant?: ButtonVariant | undefined;
}

interface LinkButtonProps extends BaseProps {
  href: string;
}

interface ActionButtonProps extends BaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {}

function buttonClass(variant: ButtonVariant, className?: string): string {
  const base =
    "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const palette =
    variant === "primary"
      ? "bg-[linear-gradient(180deg,#0a1628,#0e2237)] text-white shadow-[0_12px_30px_rgba(10,22,40,0.18)] hover:-translate-y-0.5"
      : variant === "secondary"
        ? "border border-[var(--line)] bg-white/92 text-[var(--ink)] shadow-[0_8px_20px_rgba(10,22,40,0.06)] hover:-translate-y-0.5 hover:bg-[var(--surface-3)]"
        : "text-[var(--ink)] hover:bg-white/70";

  return `${base} ${palette} ${className || ""}`.trim();
}

export function LinkButton({ href, children, className, variant = "primary" }: LinkButtonProps) {
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function ActionButton({
  children,
  className,
  variant = "primary",
  type = "button",
  onClick,
  disabled,
  ...props
}: ActionButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, className)}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

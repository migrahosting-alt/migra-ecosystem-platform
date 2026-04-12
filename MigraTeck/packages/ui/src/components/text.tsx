import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

type TextSize = "body" | "sm" | "eyebrow";

export type TextProps = HTMLAttributes<HTMLParagraphElement> & {
  children: ReactNode;
  size?: TextSize;
};

const sizeClasses: Record<TextSize, string> = {
  body: "text-base leading-7 text-slate-600",
  sm: "text-sm leading-7 text-slate-600",
  eyebrow: "text-sm font-semibold uppercase tracking-[0.16em] text-slate-500",
};

export function Text({
  children,
  className,
  size = "body",
  ...props
}: TextProps) {
  return (
    <p className={cx(sizeClasses[size], className)} {...props}>
      {children}
    </p>
  );
}

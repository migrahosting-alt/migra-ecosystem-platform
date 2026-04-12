import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

type GridVariant = "cards" | "compact" | "split";

export type GridProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  variant?: GridVariant;
};

const variantClasses: Record<GridVariant, string> = {
  cards: "grid gap-6 md:grid-cols-2 xl:grid-cols-3",
  compact: "grid gap-4 sm:grid-cols-2 xl:grid-cols-4",
  split: "grid gap-8 lg:grid-cols-2",
};

export function Grid({
  children,
  className,
  variant = "cards",
  ...props
}: GridProps) {
  return (
    <div className={cx(variantClasses[variant], className)} {...props}>
      {children}
    </div>
  );
}

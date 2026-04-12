import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div
      className={cx(
        "rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,248,248,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_18px_45px_rgba(15,23,42,0.06)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type SectionProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function Section({ children, className, ...props }: SectionProps) {
  return (
    <section className={cx("relative py-24 sm:py-28", className)} {...props}>
      {children}
    </section>
  );
}

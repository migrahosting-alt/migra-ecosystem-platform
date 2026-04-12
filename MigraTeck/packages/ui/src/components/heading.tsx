import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

type HeadingAs = "h1" | "h2" | "h3" | "h4";
type HeadingSize = "display" | "xl" | "lg" | "md";

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: HeadingAs;
  children: ReactNode;
  size?: HeadingSize;
};

const sizeClasses: Record<HeadingSize, string> = {
  display: "text-5xl font-semibold tracking-tight sm:text-6xl",
  xl: "text-4xl font-semibold tracking-tight sm:text-5xl",
  lg: "text-3xl font-semibold tracking-tight",
  md: "text-xl font-semibold tracking-tight",
};

export function Heading({
  as = "h2",
  children,
  className,
  size = "lg",
  ...props
}: HeadingProps) {
  const Component = as;

  return (
    <Component className={cx("text-slate-950", sizeClasses[size], className)} {...props}>
      {children}
    </Component>
  );
}

import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type ContainerProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Container({ children, className, ...props }: ContainerProps) {
  return (
    <div
      className={cx("mx-auto w-full max-w-7xl px-6 lg:px-8", className)}
      {...props}
    >
      {children}
    </div>
  );
}

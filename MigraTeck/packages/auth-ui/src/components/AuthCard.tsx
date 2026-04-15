import type { ReactNode } from "react";
import { Card } from "./Card";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="w-full rounded-[2rem] p-6 md:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">{title}</h1>
        {subtitle ? <p className="text-sm text-zinc-400">{subtitle}</p> : null}
      </div>
      <div className="mt-6 space-y-4">{children}</div>
      {footer ? <div className="mt-6 border-t border-white/10 pt-5">{footer}</div> : null}
    </Card>
  );
}

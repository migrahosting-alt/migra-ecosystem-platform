import type { ReactNode } from "react";
import { Card } from "./Card";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="border-dashed p-10 text-center">
      <h2 className="text-xl font-semibold text-zinc-50">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-400">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </Card>
  );
}

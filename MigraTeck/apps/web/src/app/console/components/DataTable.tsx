import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
  width?: string;
};

export const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  emptyTitle = "No records yet",
  emptyDescription,
}: {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  emptyTitle?: string;
  emptyDescription?: string | undefined;
}) => {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-xs">
        <thead>
          <tr className="bg-white/[0.02] text-left text-[10px] uppercase tracking-wider text-slate-500">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2 font-medium ${
                  c.align === "right"
                    ? "text-right"
                    : c.align === "center"
                      ? "text-center"
                      : "text-left"
                }`}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="transition hover:bg-white/[0.02]">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-2.5 ${
                    c.align === "right"
                      ? "text-right"
                      : c.align === "center"
                        ? "text-center"
                        : "text-left"
                  }`}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const StatusPill = ({
  status,
  variant,
}: {
  status: string;
  variant?: "ok" | "warn" | "bad" | "neutral";
}) => {
  const v =
    variant ||
    (["active", "ok", "succeeded", "paid", "open", "running", "available", "verified", "passed"].includes(
      status.toLowerCase(),
    )
      ? "ok"
      : ["pending", "trial", "trialing", "draft", "queued", "paused", "in_progress"].includes(
            status.toLowerCase(),
          )
        ? "warn"
        : ["failed", "churned", "error", "blocked", "rejected", "past_due", "down", "expired"].includes(
              status.toLowerCase(),
            )
          ? "bad"
          : "neutral");
  const cls =
    v === "ok"
      ? "border-emerald-400/20 bg-emerald-500/15 text-emerald-300"
      : v === "warn"
        ? "border-amber-400/20 bg-amber-500/15 text-amber-300"
        : v === "bad"
          ? "border-rose-400/20 bg-rose-500/15 text-rose-300"
          : "border-slate-400/20 bg-slate-500/15 text-slate-300";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize ${cls}`}
    >
      {status}
    </span>
  );
};

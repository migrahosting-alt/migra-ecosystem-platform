import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from "react";
import { cn } from "../lib/cn";
import { Card } from "./Card";

export function DataTableShell({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn("overflow-hidden", className)} {...props} />;
}

export function DataTableToolbar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-4 border-b border-white/10 px-5 py-4 md:flex-row md:items-center md:justify-between", className)}
      {...props}
    />
  );
}

export function DataTable({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("min-w-full border-separate border-spacing-0 text-left", className)}
      {...props}
    />
  );
}

export function DataTableHead({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <thead className="bg-white/5 text-[11px] uppercase tracking-[0.16em] text-zinc-400">
      {children}
    </thead>
  );
}

export function DataTableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-white/6 transition hover:bg-white/4", className)}
      {...props}
    />
  );
}

export function DataTableCell({
  className,
  ...props
}: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-5 py-4 align-top text-sm text-zinc-200", className)} {...props} />;
}

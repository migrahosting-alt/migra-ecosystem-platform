"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReleasesTableProps } from "@/lib/ui-contracts";

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "danger"> = {
  OK: "success",
  PARTIAL: "warning",
  BLOCKED: "warning",
  FAILED: "danger",
};

export function ReleasesTable({
  env,
  rows,
  onSelectRow,
  emptyText,
}: ReleasesTableProps) {
  const t = useTranslations("releases");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("title", { defaultValue: "Releases" })} — {env}
          </CardTitle>
          <Badge variant="outline">{rows.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {emptyText ?? t("empty", { defaultValue: "No releases found." })}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                    {t("run", { defaultValue: "Run" })}
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                    {t("env", { defaultValue: "Env" })}
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                    {t("status", { defaultValue: "Status" })}
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                    {t("time", { defaultValue: "Time" })}
                  </th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">
                    {t("commit", { defaultValue: "Commit" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.runId}
                    className={`border-b border-border/50 last:border-0 ${
                      onSelectRow ? "cursor-pointer hover:bg-muted/30 transition-colors" : ""
                    }`}
                    onClick={() => onSelectRow?.(row.runId)}
                  >
                    <td className="py-2 pr-4">
                      {row.href ? (
                        <a
                          href={row.href}
                          className="font-mono text-xs text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.runId.slice(0, 12)}
                        </a>
                      ) : (
                        <span className="font-mono text-xs">{row.runId.slice(0, 12)}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className="text-[10px]">{row.env}</Badge>
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={STATUS_VARIANT[row.status] ?? "default"} className="text-[10px]">
                        {row.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">{row.timeText}</td>
                    <td className="py-2 text-xs font-mono text-muted-foreground">
                      {row.commitShort ?? "—"}
                      {row.durationText && (
                        <span className="ml-2 non-mono">{row.durationText}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
